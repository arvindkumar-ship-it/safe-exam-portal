using System.Security.Cryptography;
using SafeExam.Client.Infrastructure;

namespace SafeExam.Client.Security;

/// C-18: pehli run par ECDSA P-256 keypair; private key LocalStore (DPAPI) me. DeviceId = b64url(SHA256(pubDer))[..16].
public sealed class DeviceIdentity
{
    private const string KeyBlob = "device-key.bin";
    private readonly LocalStore _store;
    private readonly AppLogger _log;
    private readonly object _lock = new();
    private ECDsa? _key;
    private string? _id;

    public DeviceIdentity(LocalStore store, AppLogger? log = null) { _store = store; _log = log ?? AppLogger.Null; }

    public string GetDeviceId() { Ensure(); return _id!; }

    /// Future attestation ke liye (abhi backend enforce nahi karta).
    public byte[] Sign(byte[] data) { Ensure(); return _key!.SignData(data, HashAlgorithmName.SHA256); }

    private void Ensure()
    {
        lock (_lock)
        {
            if (_key != null) return;
            var pkcs8 = _store.Read(KeyBlob);
            if (pkcs8 != null)
            {
                try { var k = ECDsa.Create(); k.ImportPkcs8PrivateKey(pkcs8, out _); _key = k; }
                catch (CryptographicException) { _log.Warn("device key unreadable, regenerating"); _key = null; }
            }
            if (_key == null)
            {
                _key = ECDsa.Create(ECCurve.NamedCurves.nistP256);
                _store.Write(KeyBlob, _key.ExportPkcs8PrivateKey());   // sirf encrypted
            }
            _id = Base64Url.Encode(SHA256.HashData(_key.ExportSubjectPublicKeyInfo()))[..16];
        }
    }
}
