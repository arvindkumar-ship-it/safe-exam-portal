namespace SafeExam.Client.Security;

public static class Base64Url
{
    public static string Encode(byte[] data) =>
        Convert.ToBase64String(data).TrimEnd('=').Replace('+', '-').Replace('/', '_');

    /// FormatException throw karta hai agar input galat ho.
    public static byte[] Decode(string s)
    {
        var t = s.Replace('-', '+').Replace('_', '/');
        switch (t.Length % 4) { case 2: t += "=="; break; case 3: t += "="; break; case 1: throw new FormatException("bad base64url"); }
        return Convert.FromBase64String(t);
    }
}
