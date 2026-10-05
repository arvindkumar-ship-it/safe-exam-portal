using SafeExam.Client.Security;

namespace SafeExam.Client.Infrastructure;

/// C-14: %LOCALAPPDATA%\SafeExam\data ke andar sirf encrypted blobs. Corrupt blob => null (crash nahi).
public sealed class LocalStore
{
    private const int MaxRecordBytes = 1024 * 1024;
    private readonly SecureStorage _secure;
    private readonly object _lock = new();
    public string Root { get; }

    public LocalStore(string root, SecureStorage secure) { Root = root; _secure = secure; }

    public void Write(string name, byte[] bytes)
    {
        lock (_lock) AtomicFile.WriteAllBytes(PathFor(name), _secure.Protect(bytes));
    }

    public byte[]? Read(string name)
    {
        lock (_lock)
        {
            var p = PathFor(name);
            if (!File.Exists(p)) return null;
            try { return _secure.Unprotect(File.ReadAllBytes(p)); } catch (IOException) { return null; }
        }
    }

    public bool Exists(string name) => File.Exists(PathFor(name));

    public void Delete(string name)
    {
        lock (_lock) { var p = PathFor(name); if (File.Exists(p)) File.Delete(p); }
    }

    /// Poori data directory saaf (uninstall --wipe, tests).
    public void WipeAll()
    {
        lock (_lock)
        {
            if (!Directory.Exists(Root)) return;
            foreach (var f in Directory.GetFiles(Root, "*", SearchOption.AllDirectories)) { try { File.Delete(f); } catch (IOException) { } }
            foreach (var d in Directory.GetDirectories(Root)) { try { Directory.Delete(d, true); } catch (IOException) { } }
        }
    }

    // ---- append-only record log (offline queue): [int32 length][protected bytes] ----

    public void AppendRecord(string name, byte[] record)
    {
        lock (_lock)
        {
            Directory.CreateDirectory(Root);
            var prot = _secure.Protect(record);
            using var fs = new FileStream(PathFor(name), FileMode.Append, FileAccess.Write, FileShare.Read);
            fs.Write(BitConverter.GetBytes(prot.Length));
            fs.Write(prot);
            fs.Flush(true);
        }
    }

    /// Corrupt record skip hota hai (corrupted count me). Length header hi kharab ho to wahin ruk jaata hai.
    public List<byte[]> ReadRecords(string name, out int corrupted)
    {
        corrupted = 0;
        var result = new List<byte[]>();
        lock (_lock)
        {
            var p = PathFor(name);
            if (!File.Exists(p)) return result;
            byte[] all;
            try { all = File.ReadAllBytes(p); } catch (IOException) { return result; }
            int pos = 0;
            while (pos + 4 <= all.Length)
            {
                int len = BitConverter.ToInt32(all, pos);
                pos += 4;
                if (len <= 0 || len > MaxRecordBytes || pos + len > all.Length) { corrupted++; break; }
                var rec = _secure.Unprotect(all[pos..(pos + len)]);
                pos += len;
                if (rec == null) corrupted++; else result.Add(rec);
            }
            if (pos < all.Length && pos + 4 > all.Length) corrupted++; // adhoori trailing bytes
        }
        return result;
    }

    public void ReplaceRecords(string name, IEnumerable<byte[]> records)
    {
        lock (_lock)
        {
            using var ms = new MemoryStream();
            foreach (var r in records)
            {
                var prot = _secure.Protect(r);
                ms.Write(BitConverter.GetBytes(prot.Length));
                ms.Write(prot);
            }
            AtomicFile.WriteAllBytes(PathFor(name), ms.ToArray());
        }
    }

    private string PathFor(string name)
    {
        if (string.IsNullOrEmpty(name) || name.Any(c => !(char.IsAsciiLetterOrDigit(c) || c is '-' or '_' or '.')) || name.Contains(".."))
            throw new ArgumentException("invalid store name", nameof(name));
        return Path.Combine(Root, name);
    }
}
