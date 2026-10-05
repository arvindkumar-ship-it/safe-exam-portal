using SafeExam.Client.Browser;
using SafeExam.Client.Infrastructure;

namespace SafeExam.Client.Config;

/// Field-level validation. Har problem "CODE: message" format me; khali list = config theek hai.
public static class ExamConfigValidator
{
    public static List<string> Validate(ExamConfig c, IClock clock, Version appVersion, bool dev = false)
    {
        var p = new List<string>();
        c = c.Normalized();

        if (c.Version != 1) p.Add("UNSUPPORTED_VERSION: config version must be 1");

        if (c.ExpiresAt is null) p.Add("MISSING_FIELD: expiresAt");
        else if (clock.UtcNow >= c.ExpiresAt) p.Add("EXPIRED: this exam configuration has expired");

        if (c.IssuedAt is null) p.Add("MISSING_FIELD: issuedAt");

        if (c.AllowedHosts.Count == 0) p.Add("MISSING_FIELD: allowedHosts");
        foreach (var h in c.AllowedHosts)
            if (string.IsNullOrWhiteSpace(h) || h.Contains("://") || h.Contains('/') || h.Contains(' ') || h.Trim() == "*")
                p.Add($"BAD_ALLOWED_HOST: '{h}'");

        // examUrl
        if (string.IsNullOrWhiteSpace(c.ExamUrl)) p.Add("MISSING_FIELD: examUrl");
        else if (!Uri.TryCreate(c.ExamUrl, UriKind.Absolute, out var exam)) p.Add("BAD_URL: examUrl is not a valid URL");
        else
        {
            if (!SchemeOk(exam, dev)) p.Add("EXAM_URL_NOT_HTTPS: examUrl must use https");
            else if (c.AllowedHosts.Count > 0 && !NavigationPolicy.HostMatches(exam.IdnHost, c.AllowedHosts))
                p.Add("EXAM_HOST_NOT_ALLOWED: examUrl host is not in allowedHosts");
        }

        // apiBaseUrl
        if (string.IsNullOrWhiteSpace(c.ApiBaseUrl)) p.Add("MISSING_FIELD: apiBaseUrl");
        else if (!Uri.TryCreate(c.ApiBaseUrl, UriKind.Absolute, out var api) || !SchemeOk(api, dev))
            p.Add("API_URL_NOT_HTTPS: apiBaseUrl must be a valid https URL");

        // exit code
        if (c.ExitRequiresCode && !ExitCodeFieldsOk(c))
            p.Add("EXIT_CODE_CONFIG_INVALID: exitCodeSalt (base64) and exitCodeSha256 (hex) are required");

        // minimum client version
        if (!string.IsNullOrWhiteSpace(c.MinClientVersion))
        {
            if (!Version.TryParse(c.MinClientVersion, out var min)) p.Add("BAD_MIN_VERSION: minClientVersion is invalid");
            else if (min > appVersion) p.Add($"CLIENT_TOO_OLD: this exam needs SafeExam client {min} or newer");
        }

        // optional update settings
        if (!string.IsNullOrWhiteSpace(c.UpdateMetadataUrl))
        {
            if (!Uri.TryCreate(c.UpdateMetadataUrl, UriKind.Absolute, out var u) || u.Scheme != Uri.UriSchemeHttps
                || !NavigationPolicy.HostMatches(u.IdnHost, c.UpdateHosts))
                p.Add("BAD_UPDATE_URL: updateMetadataUrl must be https and its host must be in updateHosts");
        }
        return p;
    }

    private static bool SchemeOk(Uri u, bool dev) =>
        u.Scheme == Uri.UriSchemeHttps || (dev && u.Scheme == Uri.UriSchemeHttp && NavigationPolicy.IsLoopback(u.Host));

    private static bool ExitCodeFieldsOk(ExamConfig c)
    {
        if (string.IsNullOrEmpty(c.ExitCodeSalt) || string.IsNullOrEmpty(c.ExitCodeSha256)) return false;
        try { Convert.FromBase64String(c.ExitCodeSalt); Convert.FromHexString(c.ExitCodeSha256); return true; }
        catch (FormatException) { return false; }
    }
}
