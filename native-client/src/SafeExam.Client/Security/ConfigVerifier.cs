using System.Security.Cryptography;
using SafeExam.Client.Config;
using SafeExam.Client.Infrastructure;

namespace SafeExam.Client.Security;

/// Codes: UNKNOWN_KEY, BAD_SIGNATURE, EXPIRED, NOT_YET_VALID, MALFORMED (+ FILE_NOT_FOUND extra).
public sealed class ConfigVerificationException : Exception
{
    public string Code { get; }
    public ConfigVerificationException(string code, string? message = null) : base(message ?? code) { Code = code; }
}

public sealed record VerifiedConfig(ExamConfig Config, string KeyId);

/// ECDSA P-256 / SHA-256 signature payload bytes par. Signature format: IEEE P1363 (r||s, 64 bytes).
public sealed class ConfigVerifier
{
    public static readonly TimeSpan IssuedAtSkew = TimeSpan.FromMinutes(5);
    private readonly KeyStore _keys;
    private readonly IClock _clock;

    public ConfigVerifier(KeyStore keys, IClock clock) { _keys = keys; _clock = clock; }

    public VerifiedConfig Verify(SignedConfigFile file)
    {
        byte[] payload, sig;
        try { payload = Base64Url.Decode(file.Payload); sig = Base64Url.Decode(file.Signature); }
        catch (FormatException) { throw new ConfigVerificationException("MALFORMED", "Config encoding is invalid."); }

        using (var key = _keys.GetPublicKey(file.KeyId))
        {
            bool ok;
            try { ok = sig.Length == 64 && key.VerifyData(payload, sig, HashAlgorithmName.SHA256); }
            catch (CryptographicException) { ok = false; }
            if (!ok) throw new ConfigVerificationException("BAD_SIGNATURE", "Config signature is invalid.");
        }

        var cfg = ConfigLoader.ParsePayload(payload); // signature ke BAAD hi parse
        if (cfg.ExpiresAt is null || cfg.IssuedAt is null)
            throw new ConfigVerificationException("MALFORMED", "issuedAt/expiresAt missing.");
        var now = _clock.UtcNow;
        if (now >= cfg.ExpiresAt) throw new ConfigVerificationException("EXPIRED", "Config has expired.");
        if (cfg.IssuedAt > now + IssuedAtSkew) throw new ConfigVerificationException("NOT_YET_VALID", "Config is not valid yet.");
        return new VerifiedConfig(cfg, file.KeyId);
    }
}
