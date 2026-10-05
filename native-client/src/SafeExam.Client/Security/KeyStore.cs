using System.Security.Cryptography;
using System.Text.Json;
using SafeExam.Client.Infrastructure;

namespace SafeExam.Client.Security;

public sealed record TrustedKey(string KeyId, string PublicKeyPem, DateTimeOffset? NotAfter);

/// Trusted PUBLIC keys (embedded resource trusted_keys.json). Do keys = key rotation. Private key yahan kabhi nahi.
public sealed class KeyStore
{
    private const string P256Oid = "1.2.840.10045.3.1.7";
    private readonly Dictionary<string, TrustedKey> _keys;
    private readonly IClock _clock;

    public KeyStore(IEnumerable<TrustedKey> keys, IClock clock)
    {
        _keys = keys.ToDictionary(k => k.KeyId, StringComparer.Ordinal);
        _clock = clock;
    }

    public bool HasKeys => _keys.Count > 0;

    public static KeyStore LoadEmbedded(IClock clock)
    {
        using var s = typeof(KeyStore).Assembly.GetManifestResourceStream("trusted_keys.json")
            ?? throw new InvalidOperationException("trusted_keys.json resource missing");
        var list = JsonSerializer.Deserialize<List<TrustedKey>>(s, Json.Options) ?? new();
        return new KeyStore(list, clock);
    }

    public static KeyStore FromJson(string json, IClock clock) =>
        new(JsonSerializer.Deserialize<List<TrustedKey>>(json, Json.Options) ?? new(), clock);

    /// Caller ECDsa ko Dispose kare. Unknown / expired / non-P256 key => UNKNOWN_KEY.
    public ECDsa GetPublicKey(string keyId)
    {
        if (keyId is null || !_keys.TryGetValue(keyId, out var k))
            throw new ConfigVerificationException("UNKNOWN_KEY", "Signing key is not trusted.");
        if (k.NotAfter is { } na && _clock.UtcNow > na)
            throw new ConfigVerificationException("UNKNOWN_KEY", "Signing key has expired.");
        var ec = ECDsa.Create();
        try
        {
            ec.ImportFromPem(k.PublicKeyPem);
            var oid = ec.ExportParameters(false).Curve.Oid;
            var isP256 = oid?.Value == P256Oid || (oid?.FriendlyName ?? "").Contains("256");
            if (!isP256) throw new CryptographicException("not P-256");
            return ec;
        }
        catch (Exception e) when (e is CryptographicException or ArgumentException)
        {
            ec.Dispose();
            throw new ConfigVerificationException("UNKNOWN_KEY", "Trusted key is invalid.");
        }
    }
}
