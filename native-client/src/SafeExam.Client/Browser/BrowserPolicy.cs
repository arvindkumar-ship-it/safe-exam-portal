using Microsoft.Web.WebView2.Core;
using SafeExam.Client.Config;

namespace SafeExam.Client.Browser;

/// C-03: WebView2 settings + event policy. Faisle BrowserPolicyDecisions (pure logic) se aate hain.
public static class BrowserPolicy
{
    public static void Apply(CoreWebView2 core, ExamConfig cfg, NavigationPolicy nav)
    {
        var s = core.Settings;
        s.AreDevToolsEnabled = false;
        s.AreDefaultContextMenusEnabled = false;
        s.AreBrowserAcceleratorKeysEnabled = false;
        s.IsStatusBarEnabled = false;
        s.IsZoomControlEnabled = false;
        s.IsPasswordAutosaveEnabled = false;
        s.IsGeneralAutofillEnabled = false;
        s.AreHostObjectsAllowed = false;      // koi host object nahi — sirf 4-command bridge

        core.NewWindowRequested += (_, e) => { if (BrowserPolicyDecisions.BlockNewWindow()) e.Handled = true; };

        core.DownloadStarting += (_, e) =>
        {
            if (BrowserPolicyDecisions.CancelDownload()) { e.Cancel = true; e.Handled = true; }
        };

        core.PermissionRequested += (_, e) =>
        {
            Uri.TryCreate(e.Uri, UriKind.Absolute, out var origin);
            var allow = BrowserPolicyDecisions.AllowPermission(Map(e.PermissionKind), origin, cfg, nav);
            e.State = allow ? CoreWebView2PermissionState.Allow : CoreWebView2PermissionState.Deny;
        };
    }

    private static BrowserPermission Map(CoreWebView2PermissionKind k) => k switch
    {
        CoreWebView2PermissionKind.Camera => BrowserPermission.Camera,
        CoreWebView2PermissionKind.Microphone => BrowserPermission.Microphone,
        _ => BrowserPermission.Other,
    };
}
