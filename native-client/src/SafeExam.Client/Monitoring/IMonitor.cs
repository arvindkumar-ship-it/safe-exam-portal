namespace SafeExam.Client.Monitoring;

/// Har monitor yeh implement karta hai. Monitor sirf events report karta hai (R1/R3).
public interface IMonitor
{
    string Name { get; }
    void Start();
    void Stop();
}

/// Monitors yahan events dete hain. Severity client nahi bhejta (R2).
public interface INativeEventSink
{
    void Report(string eventType, IDictionary<string, object?>? metadata = null);
}

/// Canonical native event types (Product A event_types.py ke saath same).
public static class NativeEventTypes
{
    public const string Started = "NATIVE_CLIENT_STARTED";
    public const string UnauthorizedProcess = "UNAUTHORIZED_PROCESS";
    public const string ProcessMonitorUnavailable = "PROCESS_MONITOR_UNAVAILABLE";
    public const string MultipleMonitor = "MULTIPLE_MONITOR";
    public const string DisplayChanged = "DISPLAY_CONFIGURATION_CHANGED";
    public const string WindowBlur = "WINDOW_BLUR";
    public const string WindowFocus = "WINDOW_FOCUS";
    public const string ClipboardAttempt = "CLIPBOARD_ATTEMPT";
    public const string PrintAttempt = "PRINT_ATTEMPT";
    public const string ScreenshotAttempt = "SCREENSHOT_ATTEMPT";
    public const string CrashRecovered = "NATIVE_CRASH_RECOVERED";

    public static readonly IReadOnlySet<string> All = new HashSet<string>
    {
        Started, UnauthorizedProcess, ProcessMonitorUnavailable, MultipleMonitor, DisplayChanged,
        WindowBlur, WindowFocus, ClipboardAttempt, PrintAttempt, ScreenshotAttempt, CrashRecovered
    };

    /// Queue full hone par pehle yahi "INFO-level" events drop hote hain.
    public static bool IsLowPriority(string t) => t is WindowFocus or Started or DisplayChanged;
}

public static class MetadataKeys
{
    /// Yeh keys metadata se hamesha hata di jaati hain (R7 privacy).
    public static readonly string[] Forbidden = { "title", "windowTitle", "clipboard", "clipboardText", "text", "token", "accessToken", "password", "code" };
}
