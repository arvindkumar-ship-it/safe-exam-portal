using System.Diagnostics;
using System.Windows;
using SafeExam.Client.Bridge;
using SafeExam.Client.Browser;
using SafeExam.Client.Config;
using SafeExam.Client.Diagnostics;
using SafeExam.Client.Exam;
using SafeExam.Client.Infrastructure;
using SafeExam.Client.Monitoring;
using SafeExam.Client.Security;
using SafeExam.Client.Updates;
using SafeExam.Client.Windowing;

namespace SafeExam.Client;

/// Composition root: sab classes yahin jodi jaati hain (DI container nahi, seedha wiring — padhne me aasaan).
public partial class App : Application
{
    private readonly CliOptions _options;
    private readonly AppPaths _paths;
    private readonly IClock _clock;
    private readonly CancellationTokenSource _cts = new();
    private readonly List<IMonitor> _monitors = new();
    private AppLogger _log = AppLogger.Null;
    private CrashRecovery? _crash;
    private NativeEventReporter? _reporter;
    private WpfMessageHook? _hook;
    private ExitInterceptor? _interceptor;
    private KioskWindowManager? _kiosk;
    private BrowserHost? _browser;

    public App(CliOptions options, AppPaths paths, IClock clock)
    {
        _options = options; _paths = paths; _clock = clock;
        InitializeComponent();
        DispatcherUnhandledException += (_, e) =>
        {
            _log.Error("unhandled exception", ("type", e.Exception.GetType().Name));
            MessageBox.Show("SafeExam hit an unexpected problem. Please restart the application.", "SafeExam");
            e.Handled = true;
        };
    }

    protected override async void OnStartup(StartupEventArgs e)
    {
        base.OnStartup(e);
        Directory.CreateDirectory(_paths.Root);
        _log = AppLogger.ToFile(_clock, _paths.LogDir);
        var window = new MainWindow();
        MainWindow = window;
        window.Show();

        // 1) Signed config: parse -> verify -> validate. Fail => readable message, exam start nahi.
        var keys = KeyStore.LoadEmbedded(_clock);
        var result = await new ConfigPipeline(keys, _clock, Program.AppVersion, _options.Dev).LoadAsync(_options.ConfigPath);
        if (!result.Success)
        {
            _log.Warn("config rejected", ("code", result.ErrorCode));
            window.ShowStatus(result.Message ?? "The exam configuration is not valid.");
            return;
        }
        var cfg = result.Config!;

        try { await StartExamAsync(window, cfg, keys); }
        catch (Exception ex)
        {
            _log.Error("startup failed", ("type", ex.GetType().Name));
            window.ShowStatus("SafeExam could not start (" + ex.GetType().Name + "). Please restart and try again.", systemCheck: true);
        }
    }

    private async Task StartExamAsync(MainWindow window, ExamConfig cfg, KeyStore keys)
    {
        // 2) Storage + identity
        var secure = new SecureStorage(new DpapiProtector(), _paths.SecretsDir);
        var store = new LocalStore(_paths.DataDir, secure);
        var device = new DeviceIdentity(store, _log);

        // 3) API + session + event uploader
        var api = new ApiClient(ApiClient.CreateHttpClient(), new Uri(cfg.ApiBaseUrl!), Program.AppVersion.ToString(3));
        var session = new SessionManager(api, _clock, cfg, _log);
        api.Tokens = session;
        var access = new AccessibilityPolicy(cfg);
        _reporter = new NativeEventReporter(_clock, device.GetDeviceId, session, api,
            attemptId => new OfflineQueue(store, "events-" + attemptId + ".queue", _log), access, _log);
        var reporter = _reporter;

        // 4) Crash recovery marker + session blob tracking
        _crash = new CrashRecovery(_paths.RunningLock, _clock, _log);
        var wasCrash = _crash.MarkStart();
        var recovery = new SessionRecovery(store, session, _clock, _log);
        recovery.StartTracking();
        reporter.Report(NativeEventTypes.Started);
        _crash.ReportIfCrashed(reporter);
        _ = reporter.RunAsync(_cts.Token);

        // 5) Kiosk window + exit protection
        var exit = new ExitPolicy(cfg, _clock);
        var adapter = new WpfWindowAdapter(window);
        _kiosk = new KioskWindowManager(reporter);
        _interceptor = new ExitInterceptor();
        _interceptor.Attach(adapter, exit, new WpfExitPrompt(window), _kiosk);
        _kiosk.Enter(adapter);

        // 6) Native monitors (event-only, kill nahi)
        var display = new Win32DisplayProvider();
        _hook = new WpfMessageHook(window, display);
        var print = new PrintMonitor(reporter, _clock, () => session.IsActive, _hook, _log);
        _monitors.Add(new ProcessMonitor(new SystemProcessProvider(), reporter, cfg, _clock, access, _log));
        _monitors.Add(new WindowMonitor(new Win32ForegroundProvider(), reporter, Process.GetCurrentProcess().ProcessName));
        _monitors.Add(new DisplayMonitor(display, reporter, cfg, access));
        _monitors.Add(new ClipboardMonitor(new WpfClipboard(), _hook, reporter, cfg, _clock, access, null, _log));
        _monitors.Add(print);
        foreach (var m in _monitors) m.Start();

        // 7) Browser + bridge
        var nav = new NavigationPolicy(cfg, _options.Dev);
        _browser = new BrowserHost(window.BrowserControl, _paths, _log);
        _browser.BrowserError += (_, msg) => window.Dispatcher.Invoke(() => window.ShowStatus(msg, systemCheck: true));
        window.SystemCheckRequested += async (_, _) => await ShowSystemCheckAsync(window, cfg, api);

        NativeBridge? bridge = null;
        reporter.EventReported += (_, ev) => bridge?.Push(ev);           // UI toast ke liye mirror
        var ok = await _browser.InitializeAsync(cfg, nav, transport =>
        {
            bridge = new NativeBridge(transport, session, exit, cfg, reporter,
                () => _monitors.Select(m => m.Name).ToList(), _options.Dev, Program.AppVersion.ToString(3));
            bridge.ExitApproved += (_, _) => window.Dispatcher.Invoke(() => { _interceptor!.AuthorizeExit(); window.Close(); });
            return bridge;
        }, print);
        if (!ok) return;                                                  // BrowserError ne message dikha diya

        // 8) Session end => kiosk chhodo, exit free
        session.SessionClosed += (_, reason) => window.Dispatcher.Invoke(async () =>
        {
            _log.Info("session closed", ("reason", reason));
            foreach (var m in _monitors) m.Stop();
            _kiosk!.Exit();
            _interceptor!.AuthorizeExit();
            await _browser!.ClearSessionData();
        });

        // 9) Crash ke baad session restore, phir exam page
        var outcome = await recovery.RestoreAsync(wasCrash);
        _log.Info("restore outcome", ("outcome", outcome.ToString()));
        _browser.Navigate(cfg.ExamUrl!);

        _ = CheckUpdatesAsync(cfg, keys, session);
    }

    private async Task ShowSystemCheckAsync(MainWindow window, ExamConfig cfg, ApiClient api)
    {
        var runner = new DiagnosticsRunner(_clock, new WindowsDiagnosticsProbe(), new SystemProcessProvider(),
            new Win32DisplayProvider(), Program.AppVersion.ToString(3));
        var report = await runner.RunAsync(cfg, true, api);
        window.ShowStatus(DiagnosticsRunner.ToJson(report), systemCheck: true);
    }

    /// Update sirf tab jab config me metadata URL ho aur exam active na ho (UpdateManager khud bhi check karta hai).
    private async Task CheckUpdatesAsync(ExamConfig cfg, KeyStore keys, SessionManager session)
    {
        if (string.IsNullOrWhiteSpace(cfg.UpdateMetadataUrl)) return;
        try
        {
            var um = new UpdateManager(new HttpUpdateTransport(), new UpdateVerifier(keys), Program.AppVersion,
                _paths.AppDir, () => session.IsActive, new ProcessHealthCheck(),
                new Uri(cfg.UpdateMetadataUrl), cfg.UpdateHosts, _log);
            var outcome = await um.CheckAndInstallAsync(_cts.Token);
            _log.Info("update check", ("outcome", outcome.ToString()));
        }
        catch (Exception e) { _log.Warn("update check failed", ("type", e.GetType().Name)); }
    }

    protected override void OnExit(ExitEventArgs e)
    {
        _cts.Cancel();
        foreach (var m in _monitors) { try { m.Stop(); } catch { /* ignore */ } }
        _hook?.Dispose();
        _crash?.MarkCleanExit();
        try { if (Directory.Exists(_paths.WebViewProfile)) Directory.Delete(_paths.WebViewProfile, true); } catch { /* WebView2 may still hold files */ }
        base.OnExit(e);
    }
}
