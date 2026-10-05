using Microsoft.Web.WebView2.Core;

namespace SafeExam.Client.Diagnostics;

public sealed class WindowsDiagnosticsProbe : IDiagnosticsProbe
{
    public string OsVersion() => Environment.OSVersion.VersionString;

    public string? WebView2Version()
    {
        try { return CoreWebView2Environment.GetAvailableBrowserVersionString(); }
        catch (Exception) { return null; }     // runtime missing
    }
}
