using System.Diagnostics;
using System.IO.Compression;
using System.Net.Http.Json;
using SafeExam.Client.Browser;
using SafeExam.Client.Infrastructure;
using SafeExam.Client.Security;

namespace SafeExam.Client.Updates;

public enum UpdateOutcome
{
    Installed, NoUpdate, SkippedOffline, SkippedExamActive,
    RejectedDowngrade, RejectedHash, RejectedSignature, RejectedInvalid, RolledBack
}

public interface IUpdateTransport
{
    Task<UpdateMetadata?> FetchMetadataAsync(Uri url, CancellationToken ct);
    Task DownloadAsync(Uri url, string destPath, CancellationToken ct);
}

public interface IHealthCheck { Task<bool> RunAsync(string exePath, CancellationToken ct); }

/// C-19: fetch -> version check -> download -> SHA-256 -> signature -> (exam inactive) -> install -> health-check (fail => rollback).
/// Unsigned / modified package kabhi execute nahi hota.
public sealed class UpdateManager
{
    public const string ExeName = "SafeExam.Client.exe";
    private readonly IUpdateTransport _transport;
    private readonly UpdateVerifier _verifier;
    private readonly Version _current;
    private readonly string _appRoot;
    private readonly Func<bool> _examActive;
    private readonly IHealthCheck _health;
    private readonly Uri _metadataUrl;
    private readonly IReadOnlyList<string> _updateHosts;
    private readonly AppLogger _log;

    public UpdateManager(IUpdateTransport transport, UpdateVerifier verifier, Version current, string appRoot,
        Func<bool> examActive, IHealthCheck health, Uri metadataUrl, IReadOnlyList<string> updateHosts, AppLogger? log = null)
    {
        _transport = transport; _verifier = verifier; _current = current; _appRoot = appRoot;
        _examActive = examActive; _health = health; _metadataUrl = metadataUrl; _updateHosts = updateHosts;
        _log = log ?? AppLogger.Null;
    }

    private string PointerPath => Path.Combine(_appRoot, "current.txt");

    public string? ReadCurrentPointer()
    {
        try { return File.Exists(PointerPath) ? File.ReadAllText(PointerPath).Trim() : null; } catch (IOException) { return null; }
    }

    /// Launcher: pointer jis version ko point kare uska exe (warna null).
    public static string? ResolveCurrentExe(string appRoot)
    {
        try
        {
            var p = Path.Combine(appRoot, "current.txt");
            if (!File.Exists(p)) return null;
            var v = File.ReadAllText(p).Trim();
            if (v.Length == 0 || v.Any(c => !(char.IsAsciiLetterOrDigit(c) || c is '.' or '-'))) return null;
            var exe = Path.Combine(appRoot, v, ExeName);
            return File.Exists(exe) ? exe : null;
        }
        catch (IOException) { return null; }
    }

    public async Task<UpdateOutcome> CheckAndInstallAsync(CancellationToken ct = default)
    {
        if (_examActive()) return UpdateOutcome.SkippedExamActive;        // exam ke dauran kabhi update nahi
        if (_metadataUrl.Scheme != Uri.UriSchemeHttps || !NavigationPolicy.HostMatches(_metadataUrl.IdnHost, _updateHosts))
            return UpdateOutcome.RejectedInvalid;

        UpdateMetadata? m;
        try { m = await _transport.FetchMetadataAsync(_metadataUrl, ct); }
        catch (Exception e) when (e is HttpRequestException or TaskCanceledException or IOException)
        { return UpdateOutcome.SkippedOffline; }
        if (m == null) return UpdateOutcome.SkippedOffline;

        if (!Version.TryParse(m.Version, out var ver) || !Uri.TryCreate(m.PackageUrl, UriKind.Absolute, out var pkg)
            || pkg.Scheme != Uri.UriSchemeHttps || !NavigationPolicy.HostMatches(pkg.IdnHost, _updateHosts)
            || m.Sha256.Length != 64 || m.Version.Any(c => !(char.IsAsciiLetterOrDigit(c) || c is '.' or '-')))
            return UpdateOutcome.RejectedInvalid;
        if (ver < _current) return UpdateOutcome.RejectedDowngrade;
        if (ver == _current) return UpdateOutcome.NoUpdate;

        var tmp = Path.Combine(Path.GetTempPath(), "safeexam-update-" + Guid.NewGuid().ToString("N") + ".zip");
        try
        {
            try { await _transport.DownloadAsync(pkg, tmp, ct); }
            catch (Exception e) when (e is HttpRequestException or TaskCanceledException or IOException)
            { return UpdateOutcome.SkippedOffline; }

            if (!_verifier.VerifyHash(m, tmp)) { _log.Warn("update hash mismatch"); return UpdateOutcome.RejectedHash; }
            if (!_verifier.VerifySignature(m)) { _log.Warn("update signature invalid"); return UpdateOutcome.RejectedSignature; }
            if (_examActive()) return UpdateOutcome.SkippedExamActive;    // download ke dauran exam shuru ho gaya

            return await InstallAsync(m.Version, tmp, ct);
        }
        finally { try { if (File.Exists(tmp)) File.Delete(tmp); } catch (IOException) { } }
    }

    private async Task<UpdateOutcome> InstallAsync(string version, string zipPath, CancellationToken ct)
    {
        var target = Path.Combine(_appRoot, version);
        var previous = ReadCurrentPointer();
        if (Directory.Exists(target)) Directory.Delete(target, true);
        SafeExtract(zipPath, target);

        AtomicFile.WriteAllBytes(PointerPath, System.Text.Encoding.UTF8.GetBytes(version));
        bool healthy;
        try { healthy = await _health.RunAsync(Path.Combine(target, ExeName), ct); } catch { healthy = false; }
        if (healthy) { _log.Info("update installed", ("version", version)); return UpdateOutcome.Installed; }

        // rollback
        if (previous != null) AtomicFile.WriteAllBytes(PointerPath, System.Text.Encoding.UTF8.GetBytes(previous));
        else File.Delete(PointerPath);
        try { Directory.Delete(target, true); } catch (IOException) { }
        _log.Warn("update health-check failed, rolled back", ("version", version));
        return UpdateOutcome.RolledBack;
    }

    /// Zip-slip safe extract (../ wale entries reject).
    internal static void SafeExtract(string zipPath, string targetDir)
    {
        Directory.CreateDirectory(targetDir);
        var root = Path.GetFullPath(targetDir) + Path.DirectorySeparatorChar;
        using var zip = ZipFile.OpenRead(zipPath);
        foreach (var entry in zip.Entries)
        {
            var dest = Path.GetFullPath(Path.Combine(targetDir, entry.FullName));
            if (!dest.StartsWith(root, StringComparison.Ordinal)) throw new InvalidDataException("zip entry escapes target");
            if (entry.FullName.EndsWith('/')) { Directory.CreateDirectory(dest); continue; }
            Directory.CreateDirectory(Path.GetDirectoryName(dest)!);
            entry.ExtractToFile(dest, overwrite: true);
        }
    }
}

public sealed class HttpUpdateTransport : IUpdateTransport
{
    private const long MaxPackageBytes = 300L * 1024 * 1024;
    private readonly HttpClient _http;
    public HttpUpdateTransport(HttpClient? http = null) { _http = http ?? ApiClient.CreateHttpClient(); }

    public async Task<UpdateMetadata?> FetchMetadataAsync(Uri url, CancellationToken ct)
    {
        using var cts = CancellationTokenSource.CreateLinkedTokenSource(ct); cts.CancelAfter(TimeSpan.FromSeconds(15));
        return await _http.GetFromJsonAsync<UpdateMetadata>(url, Json.Options, cts.Token);
    }

    public async Task DownloadAsync(Uri url, string destPath, CancellationToken ct)
    {
        using var resp = await _http.GetAsync(url, HttpCompletionOption.ResponseHeadersRead, ct);
        resp.EnsureSuccessStatusCode();
        if (resp.Content.Headers.ContentLength > MaxPackageBytes) throw new IOException("package too large");
        await using var fs = File.Create(destPath);
        await resp.Content.CopyToAsync(fs, ct);
    }
}

/// Naya exe `--health-check` se chalao; 20 s me exit code 0 => healthy.
public sealed class ProcessHealthCheck : IHealthCheck
{
    public async Task<bool> RunAsync(string exePath, CancellationToken ct)
    {
        if (!File.Exists(exePath)) return false;
        using var p = Process.Start(new ProcessStartInfo(exePath, "--health-check --no-redirect") { UseShellExecute = false, CreateNoWindow = true });
        if (p == null) return false;
        using var cts = CancellationTokenSource.CreateLinkedTokenSource(ct); cts.CancelAfter(TimeSpan.FromSeconds(20));
        try { await p.WaitForExitAsync(cts.Token); return p.ExitCode == 0; }
        catch (OperationCanceledException) { try { p.Kill(true); } catch { } return false; }
    }
}
