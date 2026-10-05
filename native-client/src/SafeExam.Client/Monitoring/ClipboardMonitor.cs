using SafeExam.Client.Config;
using SafeExam.Client.Infrastructure;

namespace SafeExam.Client.Monitoring;

/// Sirf Clear() — read API hi nahi hai, isliye clipboard content kabhi access nahi hota (R7).
public interface IClipboard { void Clear(); }

public interface IClipboardChangeSource
{
    event EventHandler? Changed;
    void Start();
    void Stop();
}

/// C-10: start/end par clear (3 retry); change => CLIPBOARD_ATTEMPT {action:"changed"}; phir clear.
public sealed class ClipboardMonitor : IMonitor
{
    private static readonly TimeSpan SelfChangeWindow = TimeSpan.FromMilliseconds(750);
    private readonly IClipboard _clipboard;
    private readonly IClipboardChangeSource _source;
    private readonly INativeEventSink _sink;
    private readonly IClock _clock;
    private readonly ExamConfig _cfg;
    private readonly AccessibilityPolicy _access;
    private readonly Action<TimeSpan> _sleep;
    private readonly AppLogger _log;
    private DateTimeOffset _ignoreUntil;
    private bool _started;

    public ClipboardMonitor(IClipboard clipboard, IClipboardChangeSource source, INativeEventSink sink, ExamConfig cfg,
        IClock clock, AccessibilityPolicy? access = null, Action<TimeSpan>? sleep = null, AppLogger? log = null)
    {
        _clipboard = clipboard; _source = source; _sink = sink; _cfg = cfg; _clock = clock;
        _access = access ?? new AccessibilityPolicy(cfg);
        _sleep = sleep ?? Thread.Sleep; _log = log ?? AppLogger.Null;
    }

    public string Name => "clipboard";

    public void Start()
    {
        if (_started) return;
        _started = true;
        ClearWithRetry();
        _source.Changed += OnChanged;
        _source.Start();
    }

    public void Stop()
    {
        if (!_started) return;
        _started = false;
        _source.Changed -= OnChanged;
        _source.Stop();
        ClearWithRetry();
    }

    private void OnChanged(object? s, EventArgs e)
    {
        if (_clock.UtcNow < _ignoreUntil) return;        // hamara apna Clear() ka notification
        _sink.Report(NativeEventTypes.ClipboardAttempt, new Dictionary<string, object?> { ["action"] = "changed" });
        // accommodation (screen reader etc.) me clipboard saaf nahi karte
        if (_cfg.ClearClipboardOnChange && !_access.AccommodationActive) ClearWithRetry();
    }

    /// Clear fail ho to 3 baar try; phir tolerate (exception bahar nahi).
    public bool ClearWithRetry()
    {
        _ignoreUntil = _clock.UtcNow + SelfChangeWindow;
        for (int i = 0; i < 3; i++)
        {
            try { _clipboard.Clear(); return true; }
            catch (Exception e)
            {
                _log.Warn("clipboard clear failed", ("attempt", i + 1), ("error", e.GetType().Name));
                if (i < 2) _sleep(TimeSpan.FromMilliseconds(50));
            }
        }
        return false;
    }
}
