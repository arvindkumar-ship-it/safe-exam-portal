using SafeExam.Client.Config;

namespace SafeExam.Client.Browser;

/// C-04: allowlist, https-only, userinfo/javascript:/data:/file: blocked, lookalike host blocked.
public sealed class NavigationPolicy
{
    private readonly IReadOnlyList<string> _hosts;
    private readonly bool _dev;

    public NavigationPolicy(ExamConfig cfg, bool dev = false)
    {
        _hosts = cfg.AllowedHosts ?? Array.Empty<string>();
        _dev = dev;
    }

    public (bool allowed, string reason) IsAllowed(string? url) =>
        Uri.TryCreate(url, UriKind.Absolute, out var u) ? IsAllowed(u) : (false, "invalid-uri");

    public (bool allowed, string reason) IsAllowed(Uri? uri)
    {
        if (uri is null || !uri.IsAbsoluteUri) return (false, "invalid-uri");

        var scheme = uri.Scheme.ToLowerInvariant();
        if (scheme == Uri.UriSchemeHttp)
        {
            if (!(_dev && IsLoopback(uri.Host))) return (false, "http-not-allowed");
        }
        else if (scheme != Uri.UriSchemeHttps) return (false, "scheme-blocked"); // javascript:, data:, file:, blob: ...

        if (!string.IsNullOrEmpty(uri.UserInfo)) return (false, "userinfo-not-allowed");
        if (!HostMatches(uri.IdnHost, _hosts)) return (false, "host-not-allowed");
        if (!_dev && !uri.IsDefaultPort) return (false, "port-not-allowed");
        return (true, "ok");
    }

    /// Exact match ya "*.example.com" (subdomain, apex nahi). "exam.example.com.evil.com" kabhi match nahi.
    public static bool HostMatches(string? host, IEnumerable<string> allowed)
    {
        if (string.IsNullOrWhiteSpace(host)) return false;
        host = host.Trim().Trim('[', ']').TrimEnd('.').ToLowerInvariant();
        foreach (var raw in allowed)
        {
            var e = (raw ?? "").Trim().TrimEnd('.').ToLowerInvariant();
            if (e.Length == 0) continue;
            if (e.StartsWith("*.", StringComparison.Ordinal))
            {
                var suffix = e[2..];
                if (suffix.Length > 0 && host.Length > suffix.Length + 1 && host.EndsWith("." + suffix, StringComparison.Ordinal))
                    return true;
            }
            else if (e == host) return true;
        }
        return false;
    }

    public static bool IsLoopback(string host)
    {
        host = host.Trim('[', ']').ToLowerInvariant();
        return host is "localhost" or "127.0.0.1" or "::1";
    }
}
