using SafeExam.Client.Config;

namespace SafeExam.Client.Monitoring;

public static class ProcessNames
{
    /// lowercase, trim, ".exe" strip
    public static string Normalize(string? name)
    {
        var n = (name ?? "").Trim().ToLowerInvariant();
        return n.EndsWith(".exe", StringComparison.Ordinal) ? n[..^4] : n;
    }
}

/// C-23: accessibility exceptions ek jagah. Narrator/Magnifier/OSK (+NVDA) default allowed.
public sealed class AccessibilityPolicy
{
    public static readonly string[] DefaultAllowlist = { "narrator", "magnify", "nvda", "osk" };
    private readonly HashSet<string> _allowed;
    private readonly ExamConfig _cfg;

    public AccessibilityPolicy(ExamConfig cfg)
    {
        _cfg = cfg;
        _allowed = DefaultAllowlist.Concat(cfg.AccessibilityAllowedProcesses ?? Array.Empty<string>())
            .Select(ProcessNames.Normalize).ToHashSet();
    }

    public bool IsAllowedProcess(string? name) => _allowed.Contains(ProcessNames.Normalize(name));
    public bool IsExternalDisplayAllowed => _cfg.AllowExternalDisplay;
    /// Instructor/institution ne is exam ke liye accommodation set ki hai.
    public bool AccommodationActive => _cfg.AccessibilityMode;

    /// Accommodation ho to metadata me accessibilityMode:true (server weight 0 karta hai, event phir bhi record hota hai).
    public void Decorate(IDictionary<string, object?> metadata)
    {
        if (AccommodationActive) metadata["accessibilityMode"] = true;
    }
}
