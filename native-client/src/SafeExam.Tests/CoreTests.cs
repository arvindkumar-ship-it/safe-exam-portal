using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using SafeExam.Client.Browser;
using SafeExam.Client.Config;
using SafeExam.Client.Exam;
using SafeExam.Client.Infrastructure;
using SafeExam.Client.Monitoring;
using SafeExam.Client.Security;
using Xunit;

namespace SafeExam.Tests;

public class CliOptionsTests
{
    [Fact] public void Parses_flags_and_config()
    {
        var o = CliOptions.Parse(new[] { "--config", "a.safeexam", "--no-ui" }, _ => null);
        Assert.Equal("a.safeexam", o.ConfigPath); Assert.True(o.NoUi);
    }
    [Fact] public void File_association_arg_is_config()
        => Assert.Equal("exam.safeexam", CliOptions.Parse(new[] { "exam.safeexam" }, _ => null).ConfigPath);
    [Fact] public void Dev_flag_from_env()
        => Assert.True(CliOptions.Parse(Array.Empty<string>(), k => k == "SAFEEXAM_ENV" ? "dev" : null).Dev);
}

public class LoggerTests
{
    [Fact] public void Secrets_are_masked()
    {
        var lines = new List<string>();
        new AppLogger(lines.Add, new FakeClock()).Info("x", ("token", "SECRET123"), ("attempt", "a1"));
        Assert.DoesNotContain("SECRET123", lines[0]);
        Assert.Contains("attempt=a1", lines[0]);
    }
}

public class NavigationPolicyTests
{
    private static NavigationPolicy Policy() => new(TestConfig.Valid(new FakeClock()));
    [Fact] public void Allowed_host_ok() => Assert.True(Policy().IsAllowed("https://exam.example.com/x").allowed);
    [Fact] public void External_host_blocked() => Assert.False(Policy().IsAllowed("https://evil.com").allowed);
    [Fact] public void Http_blocked() => Assert.False(Policy().IsAllowed("http://exam.example.com").allowed);
    [Fact] public void Javascript_blocked() => Assert.False(Policy().IsAllowed("javascript:alert(1)").allowed);
    [Fact] public void Lookalike_host_blocked() => Assert.False(Policy().IsAllowed("https://exam.example.com.evil.com").allowed);
    [Fact] public void Userinfo_blocked() => Assert.False(Policy().IsAllowed("https://u:p@exam.example.com").allowed);
}

public class ValidatorTests
{
    [Fact] public void Valid_config_has_no_problems()
    {
        var c = new FakeClock();
        Assert.Empty(ExamConfigValidator.Validate(TestConfig.Valid(c), c, new Version(1, 0, 0)));
    }
    [Fact] public void Expired_rejected()
    {
        var c = new FakeClock(); var cfg = TestConfig.Valid(c) with { ExpiresAt = c.UtcNow.AddMinutes(-1) };
        Assert.NotEmpty(ExamConfigValidator.Validate(cfg, c, new Version(1, 0, 0)));
    }
    [Fact] public void Http_exam_url_rejected()
    {
        var c = new FakeClock(); var cfg = TestConfig.Valid(c) with { ExamUrl = "http://exam.example.com/x" };
        Assert.NotEmpty(ExamConfigValidator.Validate(cfg, c, new Version(1, 0, 0)));
    }
    [Fact] public void Host_not_in_allowlist_rejected()
    {
        var c = new FakeClock(); var cfg = TestConfig.Valid(c) with { ExamUrl = "https://other.example.com/x" };
        Assert.NotEmpty(ExamConfigValidator.Validate(cfg, c, new Version(1, 0, 0)));
    }
    [Fact] public void Client_too_old_rejected()
    {
        var c = new FakeClock(); var cfg = TestConfig.Valid(c) with { MinClientVersion = "9.0.0" };
        Assert.NotEmpty(ExamConfigValidator.Validate(cfg, c, new Version(1, 0, 0)));
    }
}

public class ExitPolicyTests
{
    [Fact] public void Correct_wrong_and_lockout()
    {
        var clock = new FakeClock();
        var salt = RandomNumberGenerator.GetBytes(16);
        var cfg = TestConfig.Valid(clock) with
        {
            ExitRequiresCode = true,
            ExitCodeSalt = Convert.ToBase64String(salt),
            ExitCodeSha256 = ExitPolicy.Hash(salt, "letmeout"),
        };
        var p = new ExitPolicy(cfg, clock);
        Assert.True(p.Verify("letmeout"));
        for (int i = 0; i < 5; i++) Assert.False(p.Verify("wrong"));
        Assert.True(p.IsLockedOut);
        Assert.False(p.Verify("letmeout"));          // lockout me sahi code bhi nahi chalta
        clock.Advance(TimeSpan.FromSeconds(61));
        Assert.True(p.Verify("letmeout"));
    }
    [Fact] public void No_code_required_allows()
        => Assert.True(new ExitPolicy(TestConfig.Valid(new FakeClock()), new FakeClock()).Verify(null));
}

public class AccessibilityTests
{
    [Fact] public void Narrator_is_allowed_even_with_exe_suffix()
        => Assert.True(new AccessibilityPolicy(TestConfig.Valid(new FakeClock())).IsAllowedProcess("Narrator.exe"));
}

public class SignedConfigTests
{
    private static string B64(byte[] b) => Convert.ToBase64String(b).TrimEnd('=').Replace('+', '-').Replace('/', '_');

    private static (string path, KeyStore keys, FakeClock clock) Make(Func<FakeClock, ExamConfig> cfgFn, bool tamper = false, bool unknownKey = false)
    {
        var clock = new FakeClock();
        using var ec = ECDsa.Create(ECCurve.NamedCurves.nistP256);
        var payload = JsonSerializer.SerializeToUtf8Bytes(cfgFn(clock), new JsonSerializerOptions { PropertyNamingPolicy = JsonNamingPolicy.CamelCase });
        var sig = ec.SignData(payload, HashAlgorithmName.SHA256, DSASignatureFormat.IeeeP1363FixedFieldConcatenation);
        if (tamper) payload = Encoding.UTF8.GetBytes(Encoding.UTF8.GetString(payload).Replace("exam.example.com", "evil.example.com"));
        var env = JsonSerializer.Serialize(new { keyId = unknownKey ? "zzz" : "k1", payload = B64(payload), signature = B64(sig) });
        var path = Path.Combine(Path.GetTempPath(), Guid.NewGuid() + ".safeexam");
        File.WriteAllText(path, env);
        var keys = new KeyStore(new[] { new TrustedKey("k1", ec.ExportSubjectPublicKeyInfoPem(), null) }, clock);
        return (path, keys, clock);
    }

    private static Task<ConfigLoadResult> Run((string path, KeyStore keys, FakeClock clock) m)
        => new ConfigPipeline(m.keys, m.clock, new Version(1, 0, 0)).LoadAsync(m.path);

    [Fact] public async Task Valid_signature_ok() => Assert.True((await Run(Make(TestConfig.Valid))).Success);
    [Fact] public async Task Modified_payload_rejected()
    {
        var r = await Run(Make(TestConfig.Valid, tamper: true));
        Assert.False(r.Success); Assert.Equal("BAD_SIGNATURE", r.ErrorCode);
    }
    [Fact] public async Task Unknown_key_rejected()
    {
        var r = await Run(Make(TestConfig.Valid, unknownKey: true));
        Assert.Equal("UNKNOWN_KEY", r.ErrorCode);
    }
    [Fact] public async Task Expired_rejected()
    {
        var r = await Run(Make(c => TestConfig.Valid(c) with { ExpiresAt = c.UtcNow.AddMinutes(-1) }));
        Assert.False(r.Success);
    }
    [Fact] public async Task Missing_file_is_readable_error()
    {
        var clock = new FakeClock();
        var r = await new ConfigPipeline(new KeyStore(Array.Empty<TrustedKey>(), clock), clock, new Version(1, 0, 0)).LoadAsync("nope.safeexam");
        Assert.False(r.Success); Assert.False(string.IsNullOrWhiteSpace(r.Message));
    }
}
