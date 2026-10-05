using SafeExam.Client.Config;
using SafeExam.Client.Diagnostics;
using SafeExam.Client.Security;

namespace SafeExam.Client.Infrastructure;

/// UI ke bina chalne wale commands (--no-ui, --diagnostics, --wipe, --health-check). Exit codes: 0 ok, 2 config error.
public static class CliRunner
{
    public static async Task<int> RunNoUiAsync(CliOptions o, KeyStore keys, IClock clock, Version appVersion, TextWriter stdout, TextWriter stderr)
    {
        var res = await new ConfigPipeline(keys, clock, appVersion, o.Dev).LoadAsync(o.ConfigPath);
        if (!res.Success) { stderr.WriteLine(res.Message); return 2; }
        stdout.WriteLine("OK: configuration is valid.");
        return 0;
    }

    public static async Task<int> RunDiagnosticsAsync(CliOptions o, KeyStore keys, IClock clock, Version appVersion,
        DiagnosticsRunner runner, Func<ExamConfig, IHealthApi> healthFactory, TextWriter stdout)
    {
        ExamConfig? cfg = null; bool? valid = null;
        if (!string.IsNullOrWhiteSpace(o.ConfigPath))
        {
            var res = await new ConfigPipeline(keys, clock, appVersion, o.Dev).LoadAsync(o.ConfigPath);
            valid = res.Success; cfg = res.Config;
        }
        var report = await runner.RunAsync(cfg, valid, cfg == null ? null : healthFactory(cfg));
        stdout.WriteLine(DiagnosticsRunner.ToJson(report));
        return 0;
    }

    public static int RunWipe(AppPaths paths, TextWriter stdout)
    {
        WipeService.WipeAll(paths);
        stdout.WriteLine("Local SafeExam data wiped.");
        return 0;
    }

    public static int RunHealthCheck(KeyStore keys, TextWriter stdout)
    {
        stdout.WriteLine(keys.HasKeys ? "healthy" : "healthy (no trusted keys installed)");
        return 0;
    }
}
