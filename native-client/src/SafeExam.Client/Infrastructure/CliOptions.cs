namespace SafeExam.Client.Infrastructure;

/// Command line: --config <path> | <file>.safeexam | --no-ui | --diagnostics | --wipe | --health-check | --no-redirect
public sealed record CliOptions(
    string? ConfigPath, bool NoUi, bool Diagnostics, bool Wipe, bool HealthCheck, bool NoRedirect, bool Dev)
{
    public static CliOptions Parse(string[] args, Func<string, string?>? env = null)
    {
        env ??= Environment.GetEnvironmentVariable;
        string? config = null;
        bool noUi = false, diag = false, wipe = false, health = false, noRedirect = false;
        for (int i = 0; i < args.Length; i++)
        {
            var a = args[i];
            if (a == "--config" && i + 1 < args.Length) config = args[++i];
            else if (a.StartsWith("--config=", StringComparison.Ordinal)) config = a["--config=".Length..];
            else if (a == "--no-ui") noUi = true;
            else if (a == "--diagnostics") diag = true;
            else if (a == "--wipe") wipe = true;
            else if (a == "--health-check") health = true;
            else if (a == "--no-redirect") noRedirect = true;
            else if (!a.StartsWith("--", StringComparison.Ordinal) && a.EndsWith(".safeexam", StringComparison.OrdinalIgnoreCase))
                config = a; // double-click file association
        }
        var dev = string.Equals(env("SAFEEXAM_ENV"), "dev", StringComparison.OrdinalIgnoreCase);
        return new CliOptions(config, noUi, diag, wipe, health, noRedirect, dev);
    }
}
