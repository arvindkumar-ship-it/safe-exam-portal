using SafeExam.Client.Config;

namespace SafeExam.Client.Monitoring;

public sealed record DisplayInfo(int Count, int Width, int Height);

public interface IDisplayProvider
{
    DisplayInfo GetInfo();
    event EventHandler? Changed;
}

/// C-09: displayCount>1 && !allowExternalDisplay => MULTIPLE_MONITOR. Har change => DISPLAY_CONFIGURATION_CHANGED.
public sealed class DisplayMonitor : IMonitor
{
    private readonly IDisplayProvider _provider;
    private readonly INativeEventSink _sink;
    private readonly AccessibilityPolicy _access;
    private bool _started;

    public DisplayMonitor(IDisplayProvider provider, INativeEventSink sink, ExamConfig cfg, AccessibilityPolicy? access = null)
    {
        _provider = provider; _sink = sink; _access = access ?? new AccessibilityPolicy(cfg);
    }

    public string Name => "display";

    public void Start()
    {
        if (_started) return;
        _started = true;
        _provider.Changed += OnChanged;
        var info = _provider.GetInfo();
        if (ShouldFlag(info)) ReportMultiple(info);
    }

    public void Stop() { if (!_started) return; _started = false; _provider.Changed -= OnChanged; }

    private void OnChanged(object? s, EventArgs e)
    {
        var info = _provider.GetInfo();
        _sink.Report(NativeEventTypes.DisplayChanged, new Dictionary<string, object?>
        { ["displayCount"] = info.Count, ["width"] = info.Width, ["height"] = info.Height });
        if (ShouldFlag(info)) ReportMultiple(info);
    }

    private bool ShouldFlag(DisplayInfo i) => i.Count > 1 && !_access.IsExternalDisplayAllowed;

    private void ReportMultiple(DisplayInfo i) =>
        _sink.Report(NativeEventTypes.MultipleMonitor, new Dictionary<string, object?> { ["displayCount"] = i.Count });
}
