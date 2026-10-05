namespace SafeExam.Client.Monitoring;

public interface IForegroundProvider
{
    /// Foreground window ke process ka naam. Title kabhi nahi. Secure desktop / UAC => null.
    string? GetForegroundProcessName();
}

/// C-08: 1 s poll. Foreground != SafeExam => WINDOW_BLUR {foregroundProcess}; wapas => WINDOW_FOCUS. State-based dedupe.
public sealed class WindowMonitor : IMonitor, IDisposable
{
    private readonly IForegroundProvider _provider;
    private readonly INativeEventSink _sink;
    private readonly HashSet<string> _own;
    private readonly TimeSpan _interval;
    private readonly object _lock = new();
    private bool _blurred;
    private Timer? _timer;

    public WindowMonitor(IForegroundProvider provider, INativeEventSink sink, string? ownProcessName = null, TimeSpan? interval = null)
    {
        _provider = provider; _sink = sink;
        _own = new HashSet<string> { ProcessNames.Normalize(ownProcessName ?? "SafeExam.Client"), "msedgewebview2" };
        _interval = interval ?? TimeSpan.FromSeconds(1);
    }

    public string Name => "window";
    public void Start() => _timer ??= new Timer(_ => PollOnce(), null, TimeSpan.Zero, _interval);
    public void Stop() { _timer?.Dispose(); _timer = null; }
    public void Dispose() => Stop();

    public void PollOnce()
    {
        lock (_lock)
        {
            string? fg;
            try { fg = _provider.GetForegroundProcessName(); } catch { return; }
            if (string.IsNullOrEmpty(fg)) return;                    // system dialog => ignore
            var n = ProcessNames.Normalize(fg);
            if (_own.Contains(n))
            {
                if (_blurred) { _blurred = false; _sink.Report(NativeEventTypes.WindowFocus); }
            }
            else if (!_blurred)
            {
                _blurred = true;
                _sink.Report(NativeEventTypes.WindowBlur, new Dictionary<string, object?> { ["foregroundProcess"] = n });
            }
        }
    }
}
