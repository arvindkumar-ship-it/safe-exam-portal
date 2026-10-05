using System.Net;
using SafeExam.Client.Config;

namespace SafeExam.Client.Browser;

public enum BrowserPermission { Camera, Microphone, Other }

/// Pure-logic decisions (WebView2 types ke bina) — BrowserPolicy.Apply yahin se decide karta hai, tests yahi check karte hain.
public static class BrowserPolicyDecisions
{
    /// Camera/mic sirf agar config allow kare AUR origin allowed host ho. Baaki sab Deny.
    public static bool AllowPermission(BrowserPermission kind, Uri? origin, ExamConfig cfg, NavigationPolicy nav)
    {
        bool configAllows = kind switch
        {
            BrowserPermission.Camera => cfg.CameraAllowed,
            BrowserPermission.Microphone => cfg.MicrophoneAllowed,
            _ => false,
        };
        return configAllows && origin != null && nav.IsAllowed(origin).allowed;
    }

    public static bool CancelDownload() => true;
    public static bool BlockNewWindow() => true;

    public const string BlockedTitle = "This page is not allowed in the exam";

    /// Reason HTML-encode hota hai; blocked URL page me kabhi reflect nahi hota (injection nahi).
    /// returnUrl (config examUrl) se "Return to exam" link — nahi to student page me phans jaata (address bar nahi hai).
    public static string BlockedPageHtml(string reason, string? returnUrl = null)
    {
        var link = string.IsNullOrEmpty(returnUrl) ? "" :
            $"<p><a href=\"{WebUtility.HtmlEncode(returnUrl)}\">Return to exam</a></p>";
        return "<!doctype html><html><head><meta charset=\"utf-8\"><title>SafeExam</title></head>" +
            "<body style=\"font-family:Segoe UI,sans-serif;margin:12vh auto;max-width:34em;text-align:center\">" +
            $"<h2>{BlockedTitle}</h2><p>Go back to your exam. If you think this is a mistake, tell your invigilator.</p>{link}" +
            $"<p style=\"color:#777;font-size:.85em\">Reason: {WebUtility.HtmlEncode(reason)}</p></body></html>";
    }
}
