using System.Text.Json;
using SafeExam.Client.Infrastructure;

namespace SafeExam.Client.Exam;

public enum RestoreOutcome { NotCrash, NoSession, Rejected, StaleTerminal, Resumed, ResumedNeedsLogin }

public sealed record RecoveredSession(string AttemptId, string AccessToken, string SavedAt);

/// C-16: attemptId + token DPAPI blob me (crash recovery ke liye). Terminal/close => blob delete.
public sealed class SessionRecovery
{
    private const string BlobName = "session.bin";
    private readonly LocalStore _store;
    private readonly SessionManager _session;
    private readonly IClock _clock;
    private readonly AppLogger _log;

    public SessionRecovery(LocalStore store, SessionManager session, IClock clock, AppLogger? log = null)
    {
        _store = store; _session = session; _clock = clock; _log = log ?? AppLogger.Null;
    }

    /// Session events se blob sync rakho.
    public void StartTracking()
    {
        _session.Bound += (_, s) => Save(s);
        _session.TokenUpdated += (_, _) => Save(_session.Current);
        _session.SessionClosed += (_, _) => Clear();
    }

    public void Save(ExamSession? s)
    {
        if (s is not { Status: SessionStatus.Active } || string.IsNullOrEmpty(s.AccessToken)) return;
        _store.Write(BlobName, JsonSerializer.SerializeToUtf8Bytes(
            new RecoveredSession(s.AttemptId, s.AccessToken, _clock.UtcNow.ToIso()), Json.Options));
    }

    public RecoveredSession? TryLoad()
    {
        var b = _store.Read(BlobName);
        if (b == null) return null;
        try
        {
            var r = JsonSerializer.Deserialize<RecoveredSession>(b, Json.Options);
            return r is { AttemptId.Length: > 0, AccessToken.Length: > 0 } ? r : null;
        }
        catch (JsonException) { return null; }
    }

    public void Clear() => _store.Delete(BlobName);

    /// Crash ke baad: blob se bind, ek heartbeat se check. Terminal => resume nahi. Token expired => web me re-login.
    public async Task<RestoreOutcome> RestoreAsync(bool wasCrash, CancellationToken ct = default)
    {
        if (!wasCrash) return RestoreOutcome.NotCrash;
        var rec = TryLoad();
        if (rec == null) return RestoreOutcome.NoSession;
        if (_session.Bind(rec.AttemptId, rec.AccessToken) != BindResult.Started)
        {
            Clear();
            return RestoreOutcome.Rejected;
        }
        await _session.TickAsync(ct);
        if (!_session.IsActive) { Clear(); _log.Info("recovered session was already finished"); return RestoreOutcome.StaleTerminal; }
        return _session.TokenExpired ? RestoreOutcome.ResumedNeedsLogin : RestoreOutcome.Resumed;
    }
}
