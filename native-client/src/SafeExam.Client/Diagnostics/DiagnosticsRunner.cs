using System.Text.Json;
using SafeExam.Client.Config;
using SafeExam.Client.Infrastructure;
using SafeExam.Client.Monitoring;

namespace SafeExam.Client.Diagnostics;

public interface IDiagnosticsProbe
{
    string OsVersion();
    /// WebView2 runtime version; install nahi => null.
    string? WebView2Version();
}

public sealed record DiagnosticsReport(
    string ClientVersion, string OsVersion, string WebView2Version, int DisplayCount,
    bool? ConfigValid, bool? ApiReachable, double? ServerTimeSkewSeconds, IReadOnlyList<string> ProhibitedProcessesRunning);

/// C-22: `--diagnostics` / UI "Run system check". Koi secret/token/title nahi.
public sealed class DiagnosticsRunner
{
    public const string WebView2Missing = "NOT_INSTALLED";
    private readonly IClock _clock;
    private readonly IDiagnosticsProbe _probe;
    private readonly IProcessProvider _processes;
    private readonly IDisplayProvider _display;
    private readonly string _clientVersion;

    public DiagnosticsRunner(IClock clock, IDiagnosticsProbe probe, IProcessProvider processes, IDisplayProvider display, string clientVersion)
    {
        _clock = clock; _probe = probe; _processes = processes; _display = display; _clientVersion = clientVersion;
    }

    public async Task<DiagnosticsReport> RunAsync(ExamConfig? cfg, bool? configValid, IHealthApi? health, CancellationToken ct = default)
    {
        bool? reachable = null; double? skew = null;
        if (health != null)
        {
            var h = await health.HealthAsync(ct);
            reachable = h.Reachable;
            if (h is { Reachable: true, ServerTime: { } st }) skew = Math.Round((st - _clock.UtcNow).TotalSeconds, 1);
        }

        var running = new List<string>();
        if (cfg != null)
        {
            try
            {
                var rules = (cfg.ProhibitedProcesses ?? Array.Empty<string>()).Select(ProcessRule.Parse).ToList();
                var access = new AccessibilityPolicy(cfg);
                foreach (var raw in _processes.GetProcessNames())
                {
                    var n = ProcessNames.Normalize(raw);
                    if (!access.IsAllowedProcess(n) && rules.Any(r => r.Matches(n)) && !running.Contains(n)) running.Add(n);
                }
            }
            catch { /* provider fail => empty list */ }
        }

        int displays;
        try { displays = _display.GetInfo().Count; } catch { displays = 0; }

        return new DiagnosticsReport(_clientVersion, _probe.OsVersion(), _probe.WebView2Version() ?? WebView2Missing,
            displays, configValid, reachable, skew, running);
    }

    public static string ToJson(DiagnosticsReport r) =>
        JsonSerializer.Serialize(r, new JsonSerializerOptions(Json.Options) { WriteIndented = true });
}
