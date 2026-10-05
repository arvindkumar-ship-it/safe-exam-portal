using SafeExam.Client.Monitoring;

namespace SafeExam.Client.Windowing;

/// C-06: borderless + maximized + topmost + no taskbar. Focus loss => wapas Activate + WINDOW_BLUR.
/// Limitation: Alt+Tab / Win key user-owned PC par perfectly block nahi hote (C-24 managed policy).
public sealed class KioskWindowManager
{
    private readonly INativeEventSink _sink;
    private IWindow? _window;
    private bool _active;
    private int _suspended;

    public event EventHandler? FocusLost;
    public event EventHandler? FocusRegained;

    public KioskWindowManager(INativeEventSink sink) { _sink = sink; }

    public bool IsActive => _active;

    public void Enter(IWindow window)
    {
        _window = window;
        window.IsBorderless = true;
        window.IsMaximized = true;
        window.IsResizable = false;
        window.IsTopmost = true;
        window.ShowInTaskbar = false;
        window.Deactivated += OnDeactivated;
        window.Activated += OnActivated;
        _active = true;
        window.Activate();
    }

    /// Exam khatam: kiosk chhodo (topmost hatao) taaki student bahar ja sake.
    public void Exit()
    {
        if (_window == null) return;
        _window.Deactivated -= OnDeactivated;
        _window.Activated -= OnActivated;
        _window.IsTopmost = false;
        _window.ShowInTaskbar = true;
        _active = false;
    }

    /// Exit-code dialog jaise apne dialogs ke dauran false WINDOW_BLUR na aaye.
    public IDisposable SuspendFocusTracking()
    {
        Interlocked.Increment(ref _suspended);
        return new Releaser(this);
    }

    private sealed class Releaser : IDisposable
    {
        private KioskWindowManager? _m;
        public Releaser(KioskWindowManager m) { _m = m; }
        public void Dispose() { if (_m != null) { Interlocked.Decrement(ref _m._suspended); _m = null; } }
    }

    private void OnDeactivated(object? s, EventArgs e)
    {
        if (!_active || _suspended > 0 || _window == null) return;
        FocusLost?.Invoke(this, EventArgs.Empty);
        _sink.Report(NativeEventTypes.WindowBlur);
        var w = _window;
        w.Post(w.Activate);                         // fauran wapas aao
    }

    private void OnActivated(object? s, EventArgs e)
    {
        if (!_active || _suspended > 0) return;
        FocusRegained?.Invoke(this, EventArgs.Empty);
        _sink.Report(NativeEventTypes.WindowFocus);
    }
}
