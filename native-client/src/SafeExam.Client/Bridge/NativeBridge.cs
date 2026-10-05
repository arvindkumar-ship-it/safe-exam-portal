using System.Text;
using System.Text.Json;
using SafeExam.Client.Browser;
using SafeExam.Client.Config;
using SafeExam.Client.Exam;
using SafeExam.Client.Infrastructure;
using SafeExam.Client.Monitoring;

namespace SafeExam.Client.Bridge;

/// C-12: Section 2.4 protocol. Sirf 4 commands, origin verify, 16 KB cap, id replay cache (200).
/// Product B ke nativeBridgeAdapter.js se compatible: numeric ids echo hote hain, requestExit reply.ok == allowed.
public sealed class NativeBridge
{
    public const int MaxMessageBytes = 16 * 1024;
    public const int ReplayCacheSize = 200;
    public const string ClientType = "NATIVE_CLIENT";

    private readonly IBridgeTransport _transport;
    private readonly SessionManager _session;
    private readonly ExitPolicy _exit;
    private readonly ExamConfig _cfg;
    private readonly IUploadStatus _status;
    private readonly Func<IReadOnlyList<string>> _monitors;
    private readonly NavigationPolicy _nav;
    private readonly string _version;
    private readonly object _lock = new();
    private readonly Queue<string> _order = new();
    private readonly HashSet<string> _seen = new();

    /// requestExit sahi code ke saath aaya => host window band kare.
    public event EventHandler? ExitApproved;

    public NativeBridge(IBridgeTransport transport, SessionManager session, ExitPolicy exit, ExamConfig cfg,
        IUploadStatus status, Func<IReadOnlyList<string>> monitorNames, bool dev = false, string clientVersion = "1.0.0")
    {
        _transport = transport; _session = session; _exit = exit; _cfg = cfg; _status = status;
        _monitors = monitorNames; _nav = new NavigationPolicy(cfg, dev); _version = clientVersion;
    }

    /// Page navigate hone par B ka request-id counter 1 se restart hota hai => cache reset.
    public void ResetReplayCache() { lock (_lock) { _order.Clear(); _seen.Clear(); } }

    /// WebMessageReceived handler yahi call karta hai.
    public async Task OnWebMessageAsync(string json, string sourceUrl)
    {
        Uri.TryCreate(sourceUrl, UriKind.Absolute, out var origin);
        var reply = await HandleAsync(json, origin);
        _transport.PostJson(reply);
    }

    public Task<string> HandleAsync(string? json, Uri? origin)
    {
        if (json == null || Encoding.UTF8.GetByteCount(json) > MaxMessageBytes)
            return Task.FromResult(BridgeReply.Build(null, false, null, BridgeErrors.BadRequest));

        string? idRaw = null;
        JsonDocument? doc = null;
        try
        {
            try { doc = JsonDocument.Parse(json); } catch (JsonException) { doc = null; }
            var root = doc?.RootElement;
            if (root is { ValueKind: JsonValueKind.Object } r0 && r0.TryGetProperty("id", out var idEl)
                && (idEl.ValueKind == JsonValueKind.String || idEl.ValueKind == JsonValueKind.Number)
                && idEl.GetRawText().Length <= 100)
                idRaw = idEl.GetRawText();

            if (!_nav.IsAllowed(origin).allowed)
                return Task.FromResult(BridgeReply.Build(idRaw, false, null, BridgeErrors.OriginNotAllowed));

            if (root is not { ValueKind: JsonValueKind.Object } obj || idRaw == null
                || !obj.TryGetProperty("command", out var cmdEl) || cmdEl.ValueKind != JsonValueKind.String)
                return Task.FromResult(BridgeReply.Build(idRaw, false, null, BridgeErrors.BadRequest));

            if (!RememberId(idRaw))
                return Task.FromResult(BridgeReply.Build(idRaw, false, null, BridgeErrors.ReplayRejected));

            JsonElement payload = default;
            bool hasPayload = obj.TryGetProperty("payload", out payload) && payload.ValueKind == JsonValueKind.Object;
            if (obj.TryGetProperty("payload", out var pe) && pe.ValueKind != JsonValueKind.Object && pe.ValueKind != JsonValueKind.Null)
                return Task.FromResult(BridgeReply.Build(idRaw, false, null, BridgeErrors.BadRequest));

            return Task.FromResult(cmdEl.GetString() switch
            {
                BridgeCommands.GetClientVersion => BridgeReply.Build(idRaw, true, new { version = _version, clientType = ClientType }),
                BridgeCommands.GetSessionStatus => SessionStatus(idRaw, hasPayload ? payload : null),
                BridgeCommands.RequestExit => RequestExit(idRaw, hasPayload ? payload : null),
                _ => BridgeReply.Build(idRaw, false, null, BridgeErrors.UnknownCommand),
            });
        }
        finally { doc?.Dispose(); }
    }

    private bool RememberId(string idRaw)
    {
        lock (_lock)
        {
            if (!_seen.Add(idRaw)) return false;
            _order.Enqueue(idRaw);
            while (_order.Count > ReplayCacheSize) _seen.Remove(_order.Dequeue());
            return true;
        }
    }

    private string SessionStatus(string idRaw, JsonElement? payload)
    {
        string? attemptId = Str(payload, "attemptId"), token = Str(payload, "accessToken");
        if (attemptId != null || token != null)
        {
            if (attemptId == null || token == null) return BridgeReply.Build(idRaw, false, null, BridgeErrors.BadRequest);
            var res = _session.Bind(attemptId, token);   // bind / token refresh
            if (res is BindResult.RejectedInvalid) return BridgeReply.Build(idRaw, false, null, BridgeErrors.BadRequest);
            if (res is BindResult.RejectedDifferentAttempt or BindResult.RejectedClosed)
                return BridgeReply.Build(idRaw, false, null, BridgeErrors.BindRejected);
        }
        return BridgeReply.Build(idRaw, true, new
        {
            bound = _session.Current != null,
            sessionActive = _session.IsActive,
            configVersion = _cfg.Version ?? 0,
            monitorsRunning = _monitors(),
            lastAckedSequence = _status.LastAckedSequence,
            offlineQueueSize = _status.OfflineQueueSize,
        });
    }

    private string RequestExit(string idRaw, JsonElement? payload)
    {
        var allowed = _exit.Verify(Str(payload, "code"));
        if (allowed) ExitApproved?.Invoke(this, EventArgs.Empty);
        // B adapter `reply.ok` ko hi "allowed" maanta hai => ok == allowed; data.allowed bhi (spec).
        return BridgeReply.Build(idRaw, allowed, new { allowed }, allowed ? null : BridgeErrors.ExitDenied);
    }

    /// native -> JS: {command:"reportNativeEvent", payload:{eventType,...,event:{...}}}
    /// (flat fields B ke liye, nested `event` spec ke liye). deviceId toast ko nahi bhejte.
    public void Push(NativeEvent e)
    {
        var meta = e.Metadata.Where(kv => kv.Key != "deviceId").ToDictionary(kv => kv.Key, kv => kv.Value);
        var ev = new Dictionary<string, object?>
        { ["eventType"] = e.EventType, ["source"] = e.Source, ["occurredAt"] = e.OccurredAt, ["metadata"] = meta };
        if (e.ClientSequence > 0) ev["clientSequence"] = e.ClientSequence;
        var payload = new Dictionary<string, object?>(ev) { ["event"] = ev };
        _transport.PostJson(JsonSerializer.Serialize(new { command = BridgeCommands.ReportNativeEvent, payload }, Json.Options));
    }

    private static string? Str(JsonElement? p, string name) =>
        p is { } e && e.TryGetProperty(name, out var v) && v.ValueKind == JsonValueKind.String ? v.GetString() : null;
}
