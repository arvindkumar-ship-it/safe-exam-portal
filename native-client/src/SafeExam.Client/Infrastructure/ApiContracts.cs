using SafeExam.Client.Monitoring;

namespace SafeExam.Client.Infrastructure;

/// Server me yeh attempt statuses terminal hain.
public static class AttemptStatuses
{
    public static bool IsTerminal(string? s) => s is "SUBMITTED" or "AUTO_SUBMITTED" or "TERMINATED";
}

/// Native event (Section 2.1). Client severity nahi bhejta (R2).
public sealed record NativeEvent(
    string EventType, string Source, string OccurredAt, long ClientSequence, Dictionary<string, object?> Metadata);

public sealed record RejectedEvent(long ClientSequence, string Code);

public sealed record UploadResult
{
    public bool Success { get; init; }
    public int Status { get; init; }
    public string? ErrorCode { get; init; }
    public bool NetworkError { get; init; }          // timeout / DNS / 5xx => retry
    public long AcknowledgedUpTo { get; init; }
    public int Accepted { get; init; }
    public int Duplicates { get; init; }
    public IReadOnlyList<RejectedEvent> Rejected { get; init; } = Array.Empty<RejectedEvent>();
    public TimeSpan? RetryAfter { get; init; }

    public static UploadResult Network(string? code = "NETWORK") => new() { NetworkError = true, ErrorCode = code };
}

public sealed record HeartbeatResult
{
    public bool Success { get; init; }
    public bool NetworkError { get; init; }
    public string? ErrorCode { get; init; }
    public string? AttemptStatus { get; init; }
    public DateTimeOffset? ServerTime { get; init; }
    public DateTimeOffset? ExpiresAt { get; init; }
}

public sealed record HealthResult(bool Reachable, DateTimeOffset? ServerTime);

public interface IEventApi { Task<UploadResult> PostEventsAsync(string attemptId, IReadOnlyList<NativeEvent> events, CancellationToken ct = default); }
public interface IHeartbeatApi { Task<HeartbeatResult> HeartbeatAsync(string attemptId, CancellationToken ct = default); }
public interface IHealthApi { Task<HealthResult> HealthAsync(CancellationToken ct = default); }

/// SessionManager yeh implement karta hai; ApiClient har request par Bearer token yahin se leta hai.
public interface ITokenProvider { string? AccessToken { get; } string? AttemptId { get; } }
