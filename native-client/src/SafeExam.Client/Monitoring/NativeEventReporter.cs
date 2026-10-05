using System.Text.Json;
using SafeExam.Client.Exam;
using SafeExam.Client.Infrastructure;

namespace SafeExam.Client.Monitoring;

public enum UploadOutcome { Idle, Uploaded, Retry, WaitingForToken, Terminal, Dropped }

/// Bridge ko status dene ke liye.
public interface IUploadStatus { long LastAckedSequence { get; } int OfflineQueueSize { get; } }

/// C-13: monitors ka sink + uploader. Event banata hai (source NATIVE_CLIENT, clientSequence per attempt 1..),
/// OfflineQueue me daalta hai, 5 s / batch 20 par upload karta hai, ack ke baad hi delete (R10).
public sealed class NativeEventReporter : INativeEventSink, IUploadStatus, IDisposable
{
    public const int BatchSize = 20;
    public const int MaxPreBind = 200;
    public const int MaxMetadataBytes = 2048;
    public const string Source = "NATIVE_CLIENT";

    private readonly IClock _clock;
    private readonly Func<string> _deviceId;
    private readonly SessionManager _session;
    private readonly IEventApi _api;
    private readonly Func<string, OfflineQueue> _queueFactory;
    private readonly AccessibilityPolicy? _access;
    private readonly AppLogger _log;
    private readonly object _lock = new();
    private readonly SemaphoreSlim _gate = new(1, 1);
    private readonly List<(string type, string at, Dictionary<string, object?> meta)> _pre = new();
    private OfflineQueue? _queue;
    private string? _attemptId;
    private bool _blurred, _terminal, _waitingForToken;
    private int _waitGen, _backoffSeconds;

    public TimeSpan UploadInterval { get; set; } = TimeSpan.FromSeconds(5);
    public bool IsStopped { get; private set; }
    public long LastAckedSequence { get; private set; }
    public int OfflineQueueSize => _queue?.Count ?? 0;
    public int PendingBeforeBind { get { lock (_lock) return _pre.Count; } }
    public int CurrentBackoffSeconds => _backoffSeconds;

    /// UI toast mirror ke liye (bridge isko page tak push karta hai).
    public event EventHandler<NativeEvent>? EventReported;

    public NativeEventReporter(IClock clock, Func<string> deviceId, SessionManager session, IEventApi api,
        Func<string, OfflineQueue> queueFactory, AccessibilityPolicy? access = null, AppLogger? log = null)
    {
        _clock = clock; _deviceId = deviceId; _session = session; _api = api; _queueFactory = queueFactory;
        _access = access; _log = log ?? AppLogger.Null;
        _session.Bound += OnBound;
        _session.SessionClosed += OnClosed;
    }

    public void Dispose() { _session.Bound -= OnBound; _session.SessionClosed -= OnClosed; }

    private void OnBound(object? s, ExamSession e) => AttachAttempt(e.AttemptId);
    private void OnClosed(object? s, string reason) => _ = Task.Run(async () => { try { await FlushAndStopAsync(); } catch (Exception ex) { _log.Warn("final flush failed", ("error", ex.GetType().Name)); } });

    // ---------------- report ----------------

    public void Report(string eventType, IDictionary<string, object?>? metadata = null)
    {
        if (!NativeEventTypes.All.Contains(eventType)) { _log.Warn("unknown native event type dropped", ("type", eventType)); return; }
        NativeEvent ev;
        lock (_lock)
        {
            // WINDOW_BLUR/FOCUS: kiosk layer aur WindowMonitor dono report kar sakte hain => state se dedupe
            if (eventType == NativeEventTypes.WindowBlur) { if (_blurred) return; _blurred = true; }
            else if (eventType == NativeEventTypes.WindowFocus) { if (!_blurred) return; _blurred = false; }

            var meta = SanitizeMetadata(metadata);
            var at = _clock.UtcNow.ToIso();
            if (_queue == null)
            {
                if (_pre.Count < MaxPreBind) _pre.Add((eventType, at, meta));
                ev = new NativeEvent(eventType, Source, at, 0, meta);
            }
            else
            {
                ev = new NativeEvent(eventType, Source, at, _queue.LastSequence + 1, meta);
                _queue.Enqueue(ev);
            }
        }
        EventReported?.Invoke(this, ev);
    }

    /// Metadata: forbidden keys hata do, deviceId (+accessibilityMode) jodo, <=2048 bytes.
    public Dictionary<string, object?> SanitizeMetadata(IDictionary<string, object?>? input)
    {
        var meta = new Dictionary<string, object?>();
        if (input != null)
            foreach (var kv in input)
                if (!MetadataKeys.Forbidden.Contains(kv.Key, StringComparer.OrdinalIgnoreCase)) meta[kv.Key] = kv.Value;
        meta["deviceId"] = _deviceId();
        _access?.Decorate(meta);
        if (Size(meta) <= MaxMetadataBytes) return meta;

        foreach (var k in meta.Keys.ToList())                        // pehle lambi strings chhoti
            if (meta[k] is string s && s.Length > 200) meta[k] = s[..200];
        if (Size(meta) <= MaxMetadataBytes) return meta;

        var minimal = new Dictionary<string, object?> { ["deviceId"] = _deviceId() };
        if (meta.TryGetValue("accessibilityMode", out var am)) minimal["accessibilityMode"] = am;
        return minimal;
    }

    private static int Size(object o) => JsonSerializer.SerializeToUtf8Bytes(o, Json.Options).Length;

    // ---------------- attempt + upload ----------------

    public void AttachAttempt(string attemptId)
    {
        lock (_lock)
        {
            if (_attemptId == attemptId && _queue != null) return;
            _attemptId = attemptId;
            _queue = _queueFactory(attemptId);
            _terminal = false; _waitingForToken = false; IsStopped = false; _backoffSeconds = 0;
            foreach (var (type, at, meta) in _pre)                  // bind se pehle ke events ko ab sequence milta hai
                _queue.Enqueue(new NativeEvent(type, Source, at, _queue.LastSequence + 1, meta));
            _pre.Clear();
        }
    }

    public async Task<UploadOutcome> UploadOnceAsync(CancellationToken ct = default)
    {
        await _gate.WaitAsync(ct);
        try
        {
            OfflineQueue? q; string? attempt;
            lock (_lock) { q = _queue; attempt = _attemptId; }
            if (q == null || attempt == null) return UploadOutcome.Idle;
            if (_terminal) return UploadOutcome.Terminal;
            if (_waitingForToken && _session.TokenGeneration == _waitGen) return UploadOutcome.WaitingForToken;
            _waitingForToken = false;

            var batch = q.PeekBatch(BatchSize);
            if (batch.Count == 0) return UploadOutcome.Idle;

            UploadResult r;
            try { r = await _api.PostEventsAsync(attempt, batch, ct); }
            catch (OperationCanceledException) { throw; }
            catch (Exception) { r = UploadResult.Network(); }
            return Handle(r, batch, q);
        }
        finally { _gate.Release(); }
    }

    private UploadOutcome Handle(UploadResult r, IReadOnlyList<NativeEvent> batch, OfflineQueue q)
    {
        if (r.Success)
        {
            // 200 = server ne persist/duplicate/permanent-reject kiya => batch delete safe (R10: ack ke baad hi)
            foreach (var rej in r.Rejected) _log.Warn("event rejected by server", ("seq", rej.ClientSequence), ("code", rej.Code));
            q.RemoveSequences(batch.Select(e => e.ClientSequence));
            q.RemoveUpTo(r.AcknowledgedUpTo);
            LastAckedSequence = Math.Max(LastAckedSequence, r.AcknowledgedUpTo);
            _backoffSeconds = 0;
            return UploadOutcome.Uploaded;
        }
        if (r.NetworkError) { Backoff(r.RetryAfter); return UploadOutcome.Retry; }

        switch (r.ErrorCode)
        {
            case "TOKEN_EXPIRED": case "UNAUTHENTICATED": case "TOKEN_REVOKED":
                _waitingForToken = true; _waitGen = _session.TokenGeneration;     // naya token bridge se aane tak ruko
                return UploadOutcome.WaitingForToken;
            case "ATTEMPT_NOT_ACTIVE": case "ATTEMPT_ALREADY_SUBMITTED": case "ATTEMPT_EXPIRED":
                _terminal = true; q.Clear();
                return UploadOutcome.Terminal;
            case "RATE_LIMITED":
                Backoff(r.RetryAfter); return UploadOutcome.Retry;
            default:
                if (r.Status is >= 400 and < 500)
                {   // poison batch (validation) => infinite loop se bachne ke liye drop + log
                    _log.Warn("batch dropped (client error)", ("status", r.Status), ("code", r.ErrorCode));
                    q.RemoveSequences(batch.Select(e => e.ClientSequence));
                    return UploadOutcome.Dropped;
                }
                Backoff(r.RetryAfter); return UploadOutcome.Retry;
        }
    }

    private void Backoff(TimeSpan? retryAfter)
    {
        _backoffSeconds = _backoffSeconds == 0 ? 1 : Math.Min(30, _backoffSeconds * 2);   // 1 -> 30 s
        if (retryAfter is { } ra) _backoffSeconds = (int)Math.Min(60, Math.Max(_backoffSeconds, ra.TotalSeconds));
    }

    public async Task RunAsync(CancellationToken ct)
    {
        while (!ct.IsCancellationRequested && !IsStopped)
        {
            UploadOutcome o;
            try { o = await UploadOnceAsync(ct); }
            catch (OperationCanceledException) { break; }
            catch (Exception e) { _log.Warn("uploader error", ("error", e.GetType().Name)); o = UploadOutcome.Retry; }
            var delay = o == UploadOutcome.Uploaded && OfflineQueueSize > 0 ? TimeSpan.Zero
                : _backoffSeconds > 0 ? TimeSpan.FromSeconds(_backoffSeconds) : UploadInterval;
            if (delay > TimeSpan.Zero)
            {
                try { await Task.Delay(delay, ct); } catch (OperationCanceledException) { break; }
            }
        }
    }

    /// Session terminal ho gaya: ek final flush (server late-event window me accept karta hai), phir stop.
    public async Task FlushAndStopAsync(CancellationToken ct = default)
    {
        for (int i = 0; i < 25; i++)
        {
            var o = await UploadOnceAsync(ct);
            if (o != UploadOutcome.Uploaded || OfflineQueueSize == 0) break;
        }
        IsStopped = true;
        if (!_session.IsActive) _session.ClearCredentials();
    }
}
