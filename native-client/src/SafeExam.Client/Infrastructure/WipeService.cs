namespace SafeExam.Client.Infrastructure;

/// `--wipe` (uninstaller): data (encrypted blobs, device key, queues, session), webview profile, running.lock. Idempotent.
public static class WipeService
{
    public static void WipeAll(AppPaths paths, bool keepLogs = true)
    {
        TryDeleteDir(paths.DataDir);
        TryDeleteDir(paths.WebViewProfile);
        try { if (File.Exists(paths.RunningLock)) File.Delete(paths.RunningLock); } catch (IOException) { }
        if (!keepLogs) TryDeleteDir(paths.LogDir);
    }

    private static void TryDeleteDir(string dir)
    {
        try { if (Directory.Exists(dir)) Directory.Delete(dir, true); } catch (IOException) { } catch (UnauthorizedAccessException) { }
    }
}
