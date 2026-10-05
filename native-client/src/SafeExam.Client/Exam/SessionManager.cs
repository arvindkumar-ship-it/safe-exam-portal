using SafeExam.Client.Config;
using SafeExam.Client.Infrastructure;

namespace SafeExam.Client.Exam;

public enum BindResult { Started, TokenUpdated, RejectedInvalid, RejectedDifferentAttempt, RejectedClosed }

/// C-05: bind (web page se), heartbeat har 15 s, terminal status => Close.
public sealed class SessionManager : ITokenProvider
{
    private static readonly string[] TokenExpiredCodes = { "TOKEN_EXPIRED", "UNAUTHENTICATED", "TOKEN_REVOKED" };

    private readonly IHeartbeatApi _api;
    private readonly IClock _clock;
    private readonly string _apiBaseUrl;
    private readonly AppLogger _log;
    private readonly object _lock = new();
    private ExamSession? _session;
    private CancellationTokenSource? _cts;

    public TimeSpan HeartbeatInterval { get; set; } = TimeSpan.FromSeconds(15);
    /// Tests me false: TickAsync() khud call hota hai.
    public bool AutoLoop { get; set; } = true;

    public event EventHandler<ExamSession>? Bound;
    public event EventHandler<string>? SessionClosed;
    public event EventHandler? TokenUpdated;
    public event EventHandler? TokenRequired;

    public int TokenGeneration { get; private set; }
    public bool TokenExpired { get; private set; }
    public int HeartbeatFailures { get; private set; }

    public SessionManager(IHeartbeatApi api, IClock clock, string apiBaseUrl, AppLogger? log = null)
    {
        _api = api; _clock = clock; _apiBaseUrl = apiBaseUrl; _log = log ?? AppLogger.Null;
    }

    public SessionManager(IHeartbeatApi api, IClock clock, ExamConfig cfg, AppLogger? log = null)
        : this(api, clock, cfg.ApiBaseUrl ?? "", log) { }

    public ExamSession? Current { get { lock (_lock) return _session; } }
    public string? AttemptId => Current?.AttemptId;
    public string? AccessToken => Current?.AccessToken;
    public bool IsActive => Current is { Status: SessionStatus.Active };

    public BindResult Bind(string? attemptId, string? accessToken)
    {
        if (!ValidId(attemptId) || !ValidToken(accessToken)) return BindResult.RejectedInvalid;
        ExamSession? created = null;
        lock (_lock)
        {
            if (_session is { Status: SessionStatus.Active })
            {
                if (_session.AttemptId != attemptId) return BindResult.RejectedDifferentAttempt;
                SetToken(accessToken!);
                goto updated;
            }
            if (_session is { Status: SessionStatus.Closed } && _session.AttemptId == attemptId)
                return BindResult.RejectedClosed;
            created = _session = new ExamSession
            {
                AttemptId = attemptId!, AccessToken = accessToken!, ApiBaseUrl = _apiBaseUrl,
                StartedAt = _clock.UtcNow, Status = SessionStatus.Active,
            };
            TokenGeneration++; TokenExpired = false; HeartbeatFailures = 0;
        }
        _log.Info("session bound", ("attemptId", attemptId));
        Bound?.Invoke(this, created);
        Start();
        return BindResult.Started;

    updated:
        TokenUpdated?.Invoke(this, EventArgs.Empty);
        return BindResult.TokenUpdated;
    }

    /// Web page ne token refresh kiya.
    public void UpdateToken(string token)
    {
        if (!ValidToken(token)) return;
        lock (_lock) { if (_session == null) return; SetToken(token); }
        TokenUpdated?.Invoke(this, EventArgs.Empty);
    }

    private void SetToken(string token)
    {
        _session!.AccessToken = token;
        TokenGeneration++; TokenExpired = false;
    }

    public void Start()
    {
        lock (_lock)
        {
            if (!AutoLoop || _session is not { Status: SessionStatus.Active } || _cts != null) return;
            _cts = new CancellationTokenSource();
            var ct = _cts.Token;
            _ = Task.Run(async () =>
            {
                while (!ct.IsCancellationRequested)
                {
                    try { await Task.Delay(HeartbeatInterval, ct); await TickAsync(ct); }
                    catch (OperationCanceledException) { break; }
                    catch (Exception e) { _log.Warn("heartbeat loop error", ("error", e.GetType().Name)); }
                }
            }, ct);
        }
    }

    /// Ek heartbeat. Network failure tolerate hota hai (no close).
    public async Task TickAsync(CancellationToken ct = default)
    {
        var s = Current;
        if (s is not { Status: SessionStatus.Active }) return;
        HeartbeatResult r;
        try { r = await _api.HeartbeatAsync(s.AttemptId, ct); }
        catch (OperationCanceledException) { throw; }
        catch (Exception) { r = new HeartbeatResult { NetworkError = true }; }

        if (r.NetworkError) { HeartbeatFailures++; _log.Warn("heartbeat failed", ("count", HeartbeatFailures)); return; }
        HeartbeatFailures = 0;
        if (r.Success)
        {
            if (AttemptStatuses.IsTerminal(r.AttemptStatus)) Close(r.AttemptStatus!);
            return;
        }
        switch (r.ErrorCode)
        {
            case "ATTEMPT_ALREADY_SUBMITTED": Close("SUBMITTED"); break;
            case "ATTEMPT_EXPIRED": Close("AUTO_SUBMITTED"); break;
            case "ATTEMPT_NOT_ACTIVE": Close("TERMINATED"); break;
            default:
                if (r.ErrorCode != null && TokenExpiredCodes.Contains(r.ErrorCode))
                {
                    var first = !TokenExpired;
                    TokenExpired = true;
                    if (first) TokenRequired?.Invoke(this, EventArgs.Empty);   // web se naya token chahiye
                }
                break;
        }
    }

    /// Token memory me rehta hai taaki final event flush ho sake; ClearCredentials() uske baad.
    public void Close(string reason)
    {
        lock (_lock)
        {
            if (_session is not { Status: SessionStatus.Active }) return;
            _session.Status = SessionStatus.Closed;
            _session.CloseReason = reason;
            _cts?.Cancel(); _cts = null;
        }
        _log.Info("session closed", ("reason", reason));
        SessionClosed?.Invoke(this, reason);
    }

    public void ClearCredentials() { lock (_lock) { if (_session != null) _session.AccessToken = ""; } }

    private static bool ValidId(string? id) =>
        !string.IsNullOrEmpty(id) && id.Length <= 64 && id.All(c => char.IsAsciiLetterOrDigit(c) || c is '-' or '_');

    private static bool ValidToken(string? t) =>
        !string.IsNullOrWhiteSpace(t) && t.Length <= 8192 && t.All(c => c > ' ' && c < 127);
}
