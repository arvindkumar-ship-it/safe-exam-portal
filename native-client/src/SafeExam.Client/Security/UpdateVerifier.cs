using System.Security.Cryptography;
using System.Text;

namespace SafeExam.Client.Security;

public sealed record UpdateMetadata(string Version, string PackageUrl, string Sha256, string Signature, string KeyId, string? MinVersion);

/// C-19: signature = ECDSA P-256 over UTF8("version|sha256") (b64url, IEEE P1363); package hash SHA-256.
public sealed class UpdateVerifier
{
    private readonly KeyStore _keys;
    public UpdateVerifier(KeyStore keys) { _keys = keys; }

    public static string SignedText(string version, string sha256) => $"{version}|{sha256.ToLowerInvariant()}";

    public bool VerifySignature(UpdateMetadata m)
    {
        try
        {
            using var key = _keys.GetPublicKey(m.KeyId);
            var sig = Base64Url.Decode(m.Signature);
            return sig.Length == 64 && key.VerifyData(Encoding.UTF8.GetBytes(SignedText(m.Version, m.Sha256)), sig, HashAlgorithmName.SHA256);
        }
        catch (Exception e) when (e is ConfigVerificationException or FormatException or CryptographicException) { return false; }
    }

    public static string Sha256Hex(string filePath)
    {
        using var fs = File.OpenRead(filePath);
        return Convert.ToHexString(SHA256.HashData(fs)).ToLowerInvariant();
    }

    public bool VerifyHash(UpdateMetadata m, string filePath) =>
        string.Equals(Sha256Hex(filePath), m.Sha256.Trim(), StringComparison.OrdinalIgnoreCase);
}
