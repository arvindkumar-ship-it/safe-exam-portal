using System.Security.Cryptography;
using System.Text;
using SafeExam.Client.Config;
using SafeExam.Client.Infrastructure;

namespace SafeExam.Client.Exam;

/// Exit authorization: SHA256(salt + code) constant-time compare; 5 galat => 60 s lockout.
public sealed class ExitPolicy
{
    public const int MaxAttempts = 5;
    public static readonly TimeSpan Lockout = TimeSpan.FromSeconds(60);

    private readonly ExamConfig _cfg;
    private readonly IClock _clock;
    private readonly object _lock = new();
    private int _failures;
    private DateTimeOffset? _lockedUntil;

    public ExitPolicy(ExamConfig cfg, IClock clock) { _cfg = cfg; _clock = clock; }

    public bool RequiresCode => _cfg.ExitRequiresCode;

    public bool IsLockedOut { get { lock (_lock) return _lockedUntil is { } u && _clock.UtcNow < u; } }

    public TimeSpan RemainingLockout
    {
        get { lock (_lock) return _lockedUntil is { } u && _clock.UtcNow < u ? u - _clock.UtcNow : TimeSpan.Zero; }
    }

    /// exitRequiresCode=false => hamesha true (UI confirm dialog alag hai). Lockout me sahi code bhi false.
    public bool Verify(string? code)
    {
        lock (_lock)
        {
            if (_lockedUntil is { } u)
            {
                if (_clock.UtcNow < u) return false;
                _lockedUntil = null; _failures = 0;
            }
            if (!_cfg.ExitRequiresCode) return code != null;   // null = user ne cancel kiya
            if (code == null) return false;

            if (Matches(code)) { _failures = 0; return true; }
            if (++_failures >= MaxAttempts) { _lockedUntil = _clock.UtcNow + Lockout; _failures = 0; }
            return false;
        }
    }

    private bool Matches(string code)
    {
        try
        {
            var salt = Convert.FromBase64String(_cfg.ExitCodeSalt ?? "");
            var expected = Convert.FromHexString(_cfg.ExitCodeSha256 ?? "");
            var actual = SHA256.HashData(salt.Concat(Encoding.UTF8.GetBytes(code)).ToArray());
            return CryptographicOperations.FixedTimeEquals(actual, expected);
        }
        catch (FormatException) { return false; }
    }

    /// Helper (tools/tests): config me daalne ke liye hash.
    public static string Hash(byte[] salt, string code) =>
        Convert.ToHexString(SHA256.HashData(salt.Concat(Encoding.UTF8.GetBytes(code)).ToArray())).ToLowerInvariant();
}
