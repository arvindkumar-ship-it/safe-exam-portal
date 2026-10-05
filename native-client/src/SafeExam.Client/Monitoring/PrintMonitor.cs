using SafeExam.Client.Infrastructure;

namespace SafeExam.Client.Monitoring;

public interface IHotkeyRegistrar
{
    /// Best-effort. false => register nahi hua (chup-chaap skip).
    bool TryRegister(int virtualKey, Action onPressed);
    void UnregisterAll();
}

/// C-11: Ctrl+P / Ctrl+S block + PRINT_ATTEMPT; PrintScreen hotkey best-effort => SCREENSHOT_ATTEMPT.
/// Limitation: OS-level screenshot (Snipping Tool, Win+Shift+S, phone) bypass ho sakta hai.
public sealed class PrintMonitor : IMonitor
{
    public const int VkSnapshot = 0x2C;
    private static readonly TimeSpan DedupeWindow = TimeSpan.FromSeconds(1);
    private readonly INativeEventSink _sink;
    private readonly IClock _clock;
    private readonly Func<bool> _examActive;
    private readonly IHotkeyRegistrar? _hotkeys;
    private readonly AppLogger _log;
    private readonly Dictionary<string, DateTimeOffset> _last = new();

    public PrintMonitor(INativeEventSink sink, IClock clock, Func<bool> isExamActive, IHotkeyRegistrar? hotkeys = null, AppLogger? log = null)
    {
        _sink = sink; _clock = clock; _examActive = isExamActive; _hotkeys = hotkeys; _log = log ?? AppLogger.Null;
    }

    public string Name => "print";

    public void Start()
    {
        if (_hotkeys == null) return;
        try
        {
            if (!_hotkeys.TryRegister(VkSnapshot, OnPrintScreen)) _log.Info("PrintScreen hotkey not registered (skipped)");
        }
        catch (Exception e) { _log.Info("PrintScreen hotkey registration failed (skipped)", ("error", e.GetType().Name)); }
    }

    public void Stop() { try { _hotkeys?.UnregisterAll(); } catch { /* ignore */ } }

    /// WebView2 AcceleratorKeyPressed se: VK + ctrl => "Ctrl+P"/"Ctrl+S"/null.
    public static string? MapKey(uint virtualKey, bool ctrl) => !ctrl ? null : virtualKey switch
    {
        0x50 => "Ctrl+P",
        0x53 => "Ctrl+S",
        _ => null,
    };

    /// true => key block karo. Exam inactive ho to block hota hai par event nahi.
    public bool OnAcceleratorKey(string? key)
    {
        if (key is not ("Ctrl+P" or "Ctrl+S")) return false;
        Emit(NativeEventTypes.PrintAttempt, key, new Dictionary<string, object?> { ["key"] = key });
        return true;
    }

    private void OnPrintScreen() => Emit(NativeEventTypes.ScreenshotAttempt, "PrintScreen", null);

    private void Emit(string type, string dedupeKey, IDictionary<string, object?>? meta)
    {
        if (!_examActive()) return;
        var now = _clock.UtcNow;
        var k = type + "|" + dedupeKey;
        if (_last.TryGetValue(k, out var t) && now - t < DedupeWindow) return;
        _last[k] = now;
        _sink.Report(type, meta);
    }
}
