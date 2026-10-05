namespace SafeExam.Client.Monitoring;

public enum MatchMode { Exact, Prefix, Contains }

/// Config entry: "teamviewer" (exact) | "anydesk*" (prefix) | "*remote*" (contains)
public sealed record ProcessRule(string Name, MatchMode Mode = MatchMode.Exact)
{
    public static ProcessRule Parse(string raw)
    {
        var s = ProcessNames.Normalize(raw);
        bool starts = s.StartsWith('*'), ends = s.EndsWith('*');
        var name = s.Trim('*');
        var mode = starts ? MatchMode.Contains : ends ? MatchMode.Prefix : MatchMode.Exact;
        return new ProcessRule(name, mode);
    }

    public bool Matches(string normalizedProcessName) => Name.Length > 0 && Mode switch
    {
        MatchMode.Exact => normalizedProcessName == Name,
        MatchMode.Prefix => normalizedProcessName.StartsWith(Name, StringComparison.Ordinal),
        _ => normalizedProcessName.Contains(Name, StringComparison.Ordinal),
    };
}
