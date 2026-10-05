using System.Windows;
using System.Windows.Input;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.Wpf;
using SafeExam.Client.Bridge;
using SafeExam.Client.Config;
using SafeExam.Client.Infrastructure;
using SafeExam.Client.Monitoring;

namespace SafeExam.Client.Browser;

/// C-03/C-04: WebView2 host. Address bar nahi. Dedicated profile. Navigation allowlist (redirects bhi). Bridge hookup.
public sealed class BrowserHost
{
    private readonly WebView2 _view;
    private readonly AppPaths _paths;
    private readonly AppLogger _log;
    private ExamConfig? _cfg;
    private NavigationPolicy? _nav;
    private NativeBridge? _bridge;
    private bool _internalNavigation;

    public event EventHandler<string>? BrowserError;

    public BrowserHost(WebView2 view, AppPaths paths, AppLogger log) { _view = view; _paths = paths; _log = log; }

    /// false => init fail (BrowserError me readable message). WebView2 runtime missing => clear message.
    public async Task<bool> InitializeAsync(ExamConfig cfg, NavigationPolicy nav,
        Func<IBridgeTransport, NativeBridge> bridgeFactory, PrintMonitor? print)
    {
        _cfg = cfg; _nav = nav;
        try
        {
            // pichhle run ka profile (cookies/storage) saaf — fresh start
            try { if (Directory.Exists(_paths.WebViewProfile)) Directory.Delete(_paths.WebViewProfile, true); } catch (IOException) { }
            Directory.CreateDirectory(_paths.WebViewProfile);

            var env = await CoreWebView2Environment.CreateAsync(null, _paths.WebViewProfile, null);
            await _view.EnsureCoreWebView2Async(env);
        }
        catch (WebView2RuntimeNotFoundException)
        {
            Fail("The Microsoft WebView2 Runtime is not installed. Please install it from Microsoft (\"WebView2 Evergreen Runtime\") and start SafeExam again.");
            return false;
        }
        catch (Exception e)
        {
            _log.Error("webview init failed", ("error", e.GetType().Name));
            Fail("The exam browser could not start (" + e.GetType().Name + ").");
            return false;
        }

        var core = _view.CoreWebView2;
        BrowserPolicy.Apply(core, cfg, nav);

        _bridge = bridgeFactory(new WebView2Transport(core, _view.Dispatcher));
        core.WebMessageReceived += async (_, e) =>
        {
            try { await _bridge.OnWebMessageAsync(e.WebMessageAsJson, e.Source); }
            catch (Exception ex) { _log.Warn("bridge error", ("error", ex.GetType().Name)); }
        };

        core.NavigationStarting += OnNavigationStarting;
        core.NavigationCompleted += (_, e) =>
        {
            _internalNavigation = false;
            if (!e.IsSuccess && e.WebErrorStatus != CoreWebView2WebErrorStatus.OperationCanceled)
                Fail("Could not load the exam page (" + e.WebErrorStatus + "). Check your internet connection.");
        };
        core.ProcessFailed += (_, e) => Fail("The exam browser stopped unexpectedly (" + e.ProcessFailedKind + ").");

        if (print != null && _view.CoreWebView2Controller != null)
        {
            // Ctrl+P / Ctrl+S block. (Controller property: WebView2 WPF SDK 1.0.2792)
            _view.CoreWebView2Controller.AcceleratorKeyPressed += (_, e) =>
            {
                if (e.KeyEventKind is not (CoreWebView2KeyEventKind.KeyDown or CoreWebView2KeyEventKind.SystemKeyDown)) return;
                var ctrl = (Keyboard.Modifiers & ModifierKeys.Control) != 0;
                if (print.OnAcceleratorKey(PrintMonitor.MapKey(e.VirtualKey, ctrl))) e.Handled = true;
            };
        }
        return true;
    }

    private void OnNavigationStarting(object? sender, CoreWebView2NavigationStartingEventArgs e)
    {
        if (_internalNavigation) return;                       // hamara apna blocked-page (data: URL)
        var (allowed, reason) = _nav!.IsAllowed(e.Uri);        // redirects par bhi yahi event aata hai
        if (allowed) { _bridge?.ResetReplayCache(); return; }

        e.Cancel = true;
        _log.Info("navigation blocked", ("reason", reason));     // URL log nahi (privacy)
        _view.Dispatcher.BeginInvoke(() =>
        {
            _internalNavigation = true;
            _view.CoreWebView2.NavigateToString(BrowserPolicyDecisions.BlockedPageHtml(reason, _cfg?.ExamUrl));
        });
    }

    public void Navigate(string url)
    {
        if (_nav == null || _view.CoreWebView2 == null) return;
        var (ok, reason) = _nav.IsAllowed(url);
        if (!ok) { Fail("The exam address is not allowed (" + reason + ")."); return; }
        _view.CoreWebView2.Navigate(url);
    }

    /// Exit par cookies/cache saaf.
    public async Task ClearSessionData()
    {
        try { if (_view.CoreWebView2 != null) await _view.CoreWebView2.Profile.ClearBrowsingDataAsync(); }
        catch (Exception e) { _log.Warn("clear browsing data failed", ("error", e.GetType().Name)); }
    }

    private void Fail(string message) => BrowserError?.Invoke(this, message);
}

/// native -> JS. Monitor threads se bhi call hota hai => UI thread par marshal.
public sealed class WebView2Transport : IBridgeTransport
{
    private readonly CoreWebView2 _core;
    private readonly System.Windows.Threading.Dispatcher _dispatcher;
    public WebView2Transport(CoreWebView2 core, System.Windows.Threading.Dispatcher dispatcher) { _core = core; _dispatcher = dispatcher; }

    public void PostJson(string json)
    {
        if (_dispatcher.CheckAccess()) { Post(json); return; }
        _dispatcher.BeginInvoke(() => Post(json));
    }

    private void Post(string json) { try { _core.PostWebMessageAsJson(json); } catch (Exception) { /* page navigating */ } }
}
