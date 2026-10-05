using System.Security.Cryptography;
using System.Text;

namespace SafeExam.Client.Security;

/// Windows DPAPI (CurrentUser scope) + app-specific entropy. Doosre Windows user ka blob padh nahi sakta.
public sealed class DpapiProtector : IDataProtector
{
    private static readonly byte[] Entropy = Encoding.UTF8.GetBytes("SafeExam.Client.v1");

    public byte[] Protect(byte[] data) =>
        ProtectedData.Protect(data, Entropy, DataProtectionScope.CurrentUser);

    public byte[]? Unprotect(byte[] blob)
    {
        try { return ProtectedData.Unprotect(blob, Entropy, DataProtectionScope.CurrentUser); }
        catch (CryptographicException) { return null; }
    }
}
