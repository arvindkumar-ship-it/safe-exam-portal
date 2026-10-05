using System.Text;
using SafeExam.Client.Infrastructure;

namespace SafeExam.Client.Security;

/// OS-level data protection abstraction (Windows me DPAPI CurrentUser; tests me fake).
public interface IDataProtector
{
    byte[] Protect(byte[] data);
    /// Corrupt / doosre user ka blob => null (exception nahi).
    byte[]? Unprotect(byte[] blob);
}

/// C-14: Protect/Unprotect + chhote named secrets. Raw password / long-lived token kabhi plain disk par nahi.
public sealed class SecureStorage
{
    private readonly IDataProtector _p;
    private readonly string _dir;

    public SecureStorage(IDataProtector protector, string secretsDir) { _p = protector; _dir = secretsDir; }

    public byte[] Protect(byte[] data) => _p.Protect(data);

    public byte[]? Unprotect(byte[] blob)
    {
        try { return _p.Unprotect(blob); } catch { return null; }
    }

    public void SetSecret(string name, string value) =>
        AtomicFile.WriteAllBytes(PathFor(name), Protect(Encoding.UTF8.GetBytes(value)));

    public string? GetSecret(string name)
    {
        var path = PathFor(name);
        if (!File.Exists(path)) return null;
        try { var b = Unprotect(File.ReadAllBytes(path)); return b == null ? null : Encoding.UTF8.GetString(b); }
        catch (IOException) { return null; }
    }

    public void Delete(string name) { var p = PathFor(name); if (File.Exists(p)) File.Delete(p); }

    private string PathFor(string name)
    {
        if (string.IsNullOrEmpty(name) || name.Any(c => !(char.IsAsciiLetterOrDigit(c) || c is '-' or '_' or '.')) || name.Contains(".."))
            throw new ArgumentException("invalid secret name", nameof(name));
        return Path.Combine(_dir, name + ".sec");
    }
}
