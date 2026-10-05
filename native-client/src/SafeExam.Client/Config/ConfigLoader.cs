using System.Text.Json;
using SafeExam.Client.Infrastructure;
using SafeExam.Client.Security;

namespace SafeExam.Client.Config;

/// Sirf parse karta hai. Signature verify C-17 (ConfigVerifier) me, field validation ExamConfigValidator me.
public static class ConfigLoader
{
    public const int MaxFileBytes = 64 * 1024;

    public static async Task<SignedConfigFile> LoadAsync(string path, CancellationToken ct = default)
    {
        if (!File.Exists(path))
            throw new ConfigVerificationException("FILE_NOT_FOUND", "Config file not found.");
        if (new FileInfo(path).Length > MaxFileBytes)
            throw new ConfigVerificationException("MALFORMED", "Config file is too large.");
        var bytes = await File.ReadAllBytesAsync(path, ct);
        return ParseEnvelope(bytes);
    }

    public static SignedConfigFile ParseEnvelope(byte[] bytes)
    {
        try
        {
            bytes = StripBom(bytes);
            var f = JsonSerializer.Deserialize<SignedConfigFile>(bytes, Json.Options);
            if (f == null || string.IsNullOrWhiteSpace(f.KeyId) || string.IsNullOrWhiteSpace(f.Payload) || string.IsNullOrWhiteSpace(f.Signature))
                throw new ConfigVerificationException("MALFORMED", "Config envelope is incomplete.");
            return f;
        }
        catch (JsonException)
        {
            throw new ConfigVerificationException("MALFORMED", "Config file is not valid JSON.");
        }
    }

    /// Payload bytes (base64url decode ho chuke) -> ExamConfig
    public static ExamConfig ParsePayload(byte[] payloadBytes)
    {
        try
        {
            var cfg = JsonSerializer.Deserialize<ExamConfig>(StripBom(payloadBytes), Json.Options);
            if (cfg == null) throw new ConfigVerificationException("MALFORMED", "Config payload is empty.");
            return cfg.Normalized();
        }
        catch (JsonException)
        {
            throw new ConfigVerificationException("MALFORMED", "Config payload is not valid JSON.");
        }
    }

    private static byte[] StripBom(byte[] b) =>
        b.Length >= 3 && b[0] == 0xEF && b[1] == 0xBB && b[2] == 0xBF ? b[3..] : b;
}
