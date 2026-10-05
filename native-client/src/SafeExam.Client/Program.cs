using System.Reflection;
using SafeExam.Client.Diagnostics;
using SafeExam.Client.Infrastructure;
using SafeExam.Client.Monitoring;
using SafeExam.Client.Security;

namespace SafeExam.Client;

/// Entry point. UI ke bina chalne wale commands yahin handle hote hain; baaki sab App.xaml.cs me.
public static class Program
{
    public static Version AppVersion =>
        Assembly.GetExecutingAssembly().GetName().Version ?? new Version(1, 0, 0);

    [STAThread]
    public static int Main(string[] args)
    {
        var options = CliOptions.Parse(args);
        var paths = new AppPaths();
        var clock = new SystemClock();

        if (options.NoUi || options.Diagnostics || options.Wipe || options.HealthCheck)
        {
            NativeMethods.AttachConsole(-1);            // WinExe: parent console par stdout dikhao
            return RunCliAsync(options, paths, clock).GetAwaiter().GetResult();
        }

        var app = new App(options, paths, clock);
        return app.Run();
    }

    private static async Task<int> RunCliAsync(CliOptions o, AppPaths paths, IClock clock)
    {
        var keys = KeyStore.LoadEmbedded(clock);
        if (o.Wipe) return CliRunner.RunWipe(paths, Console.Out);
        if (o.HealthCheck) return CliRunner.RunHealthCheck(keys, Console.Out);
        if (o.Diagnostics)
        {
            var runner = new DiagnosticsRunner(clock, new WindowsDiagnosticsProbe(),
                new SystemProcessProvider(), new Win32DisplayProvider(), AppVersion.ToString(3));
            return await CliRunner.RunDiagnosticsAsync(o, keys, clock, AppVersion, runner,
                cfg => new ApiClient(ApiClient.CreateHttpClient(), new Uri(cfg.ApiBaseUrl!)), Console.Out);
        }
        return await CliRunner.RunNoUiAsync(o, keys, clock, AppVersion, Console.Out, Console.Error);
    }
}
