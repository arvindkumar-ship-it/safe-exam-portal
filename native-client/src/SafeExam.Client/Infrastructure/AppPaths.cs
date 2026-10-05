namespace SafeExam.Client.Infrastructure;

/// Saari local jagah ek hi root ke neeche: %LOCALAPPDATA%\SafeExam (SAFEEXAM_HOME se override, tests ke liye).
public sealed class AppPaths
{
    public string Root { get; }
    public AppPaths(string? root = null)
    {
        Root = root
            ?? Environment.GetEnvironmentVariable("SAFEEXAM_HOME")
            ?? Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "SafeExam");
    }
    public string LogDir => Path.Combine(Root, "logs");
    public string DataDir => Path.Combine(Root, "data");
    public string SecretsDir => Path.Combine(DataDir, "secrets");
    public string WebViewProfile => Path.Combine(Root, "webview-profile");
    public string AppDir => Path.Combine(Root, "app");
    public string RunningLock => Path.Combine(Root, "running.lock");
}
