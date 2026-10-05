using System.Net.Http.Headers;
using System.Text;
using System.Text.Json;

namespace SafeExam.Client.Infrastructure;

/// C-13: Product A backend client. Envelope {data, error:{code,message}|null, requestId}. 10 s timeout.
public sealed class ApiClient : IEventApi, IHeartbeatApi, IHealthApi
{
    public static readonly TimeSpan Timeout = TimeSpan.FromSeconds(10);
    private readonly HttpClient _http;
    private readonly Uri _base;
    private readonly string _clientVersion;

    /// Composition ke time set hota hai (SessionManager <-> ApiClient circular dependency tootne ke liye).
    public ITokenProvider? Tokens { get; set; }

    public ApiClient(HttpClient http, Uri apiBaseUrl, string clientVersion = "1.0.0")
    {
        _http = http; _base = apiBaseUrl; _clientVersion = clientVersion;
    }

    /// Redirect follow nahi (Bearer token kisi aur host par na jaye).
    public static HttpClient CreateHttpClient() =>
        new(new HttpClientHandler { AllowAutoRedirect = false }) { Timeout = System.Threading.Timeout.InfiniteTimeSpan };

    public async Task<UploadResult> PostEventsAsync(string attemptId, IReadOnlyList<NativeEvent> events, CancellationToken ct = default)
    {
        var r = await SendAsync(HttpMethod.Post, $"/attempts/{Uri.EscapeDataString(attemptId)}/events", new { events }, true, ct);
        if (r.Net) return new UploadResult { NetworkError = true, ErrorCode = r.Code ?? "NETWORK", Status = r.Status, RetryAfter = r.RetryAfter };
        if (r.Status is >= 200 and < 300 && r.Data is { } d)
        {
            var rejected = new List<RejectedEvent>();
            if (d.TryGetProperty("rejected", out var rj) && rj.ValueKind == JsonValueKind.Array)
                foreach (var x in rj.EnumerateArray())
                    rejected.Add(new RejectedEvent(x.TryGetProperty("clientSequence", out var cs) && cs.ValueKind == JsonValueKind.Number ? cs.GetInt64() : 0,
                        x.TryGetProperty("code", out var c) ? c.GetString() ?? "" : ""));
            return new UploadResult
            {
                Success = true, Status = r.Status, Rejected = rejected,
                AcknowledgedUpTo = Long(d, "acknowledgedUpTo"), Accepted = (int)Long(d, "accepted"), Duplicates = (int)Long(d, "duplicates"),
            };
        }
        return new UploadResult { Status = r.Status, ErrorCode = r.Code ?? "BAD_RESPONSE", RetryAfter = r.RetryAfter };
    }

    public async Task<HeartbeatResult> HeartbeatAsync(string attemptId, CancellationToken ct = default)
    {
        var r = await SendAsync(HttpMethod.Post, $"/attempts/{Uri.EscapeDataString(attemptId)}/heartbeat", null, true, ct);
        if (r.Net) return new HeartbeatResult { NetworkError = true, ErrorCode = r.Code };
        if (r.Status is >= 200 and < 300 && r.Data is { } d)
            return new HeartbeatResult
            {
                Success = true, AttemptStatus = Str(d, "attemptStatus"),
                ServerTime = Time(d, "serverTime"), ExpiresAt = Time(d, "expiresAt"),
            };
        return new HeartbeatResult { ErrorCode = r.Code ?? "BAD_RESPONSE" };
    }

    public async Task<HealthResult> HealthAsync(CancellationToken ct = default)
    {
        var r = await SendAsync(HttpMethod.Get, "/health", null, false, ct);
        if (r.Net || r.Status is < 200 or >= 300 || r.Data is not { } d) return new HealthResult(false, null);
        return new HealthResult(true, Time(d, "serverTime"));
    }

    // ---------- internals ----------

    private sealed record Raw(int Status, JsonElement? Data, string? Code, bool Net, TimeSpan? RetryAfter);

    private async Task<Raw> SendAsync(HttpMethod method, string path, object? body, bool auth, CancellationToken ct)
    {
        using var cts = CancellationTokenSource.CreateLinkedTokenSource(ct);
        cts.CancelAfter(Timeout);
        try
        {
            using var req = new HttpRequestMessage(method, new Uri(_base.AbsoluteUri.TrimEnd('/') + path));
            req.Headers.UserAgent.ParseAdd("SafeExamClient/" + _clientVersion);
            if (auth)
            {
                var token = Tokens?.AccessToken;
                if (string.IsNullOrEmpty(token)) return new Raw(0, null, "UNAUTHENTICATED", false, null);
                req.Headers.Authorization = new AuthenticationHeaderValue("Bearer", token);
            }
            if (body != null) req.Content = new StringContent(JsonSerializer.Serialize(body, Json.Options), Encoding.UTF8, "application/json");

            using var resp = await _http.SendAsync(req, HttpCompletionOption.ResponseContentRead, cts.Token);
            var status = (int)resp.StatusCode;
            TimeSpan? retry = resp.Headers.RetryAfter?.Delta;
            if (status >= 500) return new Raw(status, null, "SERVER_ERROR", true, retry);   // transient => retry
            var text = await resp.Content.ReadAsStringAsync(cts.Token);
            try
            {
                using var doc = JsonDocument.Parse(text);
                var root = doc.RootElement;
                string? code = null;
                if (root.TryGetProperty("error", out var e) && e.ValueKind == JsonValueKind.Object) code = Str(e, "code");
                JsonElement? data = root.TryGetProperty("data", out var d) && d.ValueKind == JsonValueKind.Object ? d.Clone() : null;
                if (status == 429) code ??= "RATE_LIMITED";
                return new Raw(status, data, code, false, retry);
            }
            catch (JsonException) { return new Raw(status, null, "BAD_RESPONSE", false, retry); }
        }
        catch (OperationCanceledException) when (!ct.IsCancellationRequested) { return new Raw(0, null, "TIMEOUT", true, null); }
        catch (HttpRequestException) { return new Raw(0, null, "NETWORK", true, null); }
    }

    private static string? Str(JsonElement e, string n) => e.TryGetProperty(n, out var v) && v.ValueKind == JsonValueKind.String ? v.GetString() : null;
    private static long Long(JsonElement e, string n) => e.TryGetProperty(n, out var v) && v.ValueKind == JsonValueKind.Number ? v.GetInt64() : 0;
    private static DateTimeOffset? Time(JsonElement e, string n) =>
        DateTimeOffset.TryParse(Str(e, n), System.Globalization.CultureInfo.InvariantCulture, System.Globalization.DateTimeStyles.AssumeUniversal, out var t) ? t : null;
}
