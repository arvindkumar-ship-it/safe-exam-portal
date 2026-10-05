using SafeExam.Client.Infrastructure;
using SafeExam.Client.Security;

namespace SafeExam.Client.Config;

public sealed record ConfigLoadResult(bool Success, ExamConfig? Config, string? ErrorCode, string? Message);

/// Flow: C-02 parse -> C-17 verify -> C-02 validate. Fail => readable message (app crash nahi).
public sealed class ConfigPipeline
{
    private readonly ConfigVerifier _verifier;
    private readonly IClock _clock;
    private readonly Version _appVersion;
    private readonly bool _dev;

    public ConfigPipeline(KeyStore keys, IClock clock, Version appVersion, bool dev = false)
    {
        _verifier = new ConfigVerifier(keys, clock);
        _clock = clock; _appVersion = appVersion; _dev = dev;
    }

    public async Task<ConfigLoadResult> LoadAsync(string? path, CancellationToken ct = default)
    {
        if (string.IsNullOrWhiteSpace(path))
            return Fail("NO_CONFIG", "No exam configuration file was provided. Open the .safeexam file you received from your institution.");
        try
        {
            var file = await ConfigLoader.LoadAsync(path, ct);
            var verified = _verifier.Verify(file);
            var problems = ExamConfigValidator.Validate(verified.Config, _clock, _appVersion, _dev);
            if (problems.Count > 0) return Fail(problems[0].Split(':')[0], Friendly(problems[0]));
            return new ConfigLoadResult(true, verified.Config, null, null);
        }
        catch (ConfigVerificationException e) { return Fail(e.Code, Friendly(e.Code + ": " + e.Message)); }
        catch (Exception e) when (e is IOException or UnauthorizedAccessException)
        { return Fail("READ_ERROR", "The configuration file could not be read."); }
    }

    private static ConfigLoadResult Fail(string code, string msg) => new(false, null, code, msg);

    private static string Friendly(string problem) => problem.Split(':')[0] switch
    {
        "FILE_NOT_FOUND" => "The configuration file was not found.",
        "UNKNOWN_KEY" => "This configuration was signed with a key this client does not trust. Please install the latest SafeExam client.",
        "BAD_SIGNATURE" => "The configuration file has been modified or is corrupted. Please download it again.",
        "EXPIRED" => "This exam configuration has expired. Please ask your institution for a new file.",
        "NOT_YET_VALID" => "This exam configuration is not valid yet. Check your computer's date and time.",
        "MALFORMED" => "The configuration file is damaged or not a SafeExam file.",
        "CLIENT_TOO_OLD" => "This exam needs a newer SafeExam client. Please update the application.",
        "EXAM_URL_NOT_HTTPS" or "API_URL_NOT_HTTPS" => "The exam configuration uses an insecure address and was rejected.",
        "EXAM_HOST_NOT_ALLOWED" => "The exam address is not on the allowed list. Contact your institution.",
        _ => "The exam configuration is not valid (" + problem + ")."
    };
}
