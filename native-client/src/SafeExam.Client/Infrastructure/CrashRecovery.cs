using SafeExam.Client.Monitoring;

namespace SafeExam.Client.Infrastructure;

/// C-16: running.lock marker. Start par likho; clean exit par delete. Next start par mila => pichla run crash tha.
public sealed class CrashRecovery
{
    private readonly string _lockPath;
    private readonly IClock _clock;
    private readonly AppLogger _log;

    public CrashRecovery(string lockPath, IClock clock, AppLogger? log = null)
    {
        _lockPath = lockPath; _clock = clock; _log = log ?? AppLogger.Null;
    }

    public bool WasCrash { get; private set; }

    /// true => pichla run crash hua tha.
    public bool MarkStart()
    {
        WasCrash = File.Exists(_lockPath);
        try
        {
            AtomicFile.WriteAllBytes(_lockPath, System.Text.Encoding.UTF8.GetBytes(_clock.UtcNow.ToIso()));
        }
        catch (IOException e) { _log.Warn("could not write running.lock", ("error", e.GetType().Name)); }
        if (WasCrash) _log.Warn("previous run did not exit cleanly");
        return WasCrash;
    }

    /// Crash mila to NATIVE_CRASH_RECOVERED ek hi baar report (marker dobara likha ja chuka hota hai).
    public void ReportIfCrashed(INativeEventSink sink)
    {
        if (!WasCrash) return;
        WasCrash = false;
        sink.Report(NativeEventTypes.CrashRecovered);
    }

    public void MarkCleanExit()
    {
        try { if (File.Exists(_lockPath)) File.Delete(_lockPath); }
        catch (IOException) { /* ignore */ }
    }
}
