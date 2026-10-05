namespace SafeExam.Client.Exam;

public enum SessionStatus { Active, Closed }

/// Ek bound attempt ka state. AccessToken sirf memory me (crash recovery ke liye alag DPAPI blob).
public sealed class ExamSession
{
    public string AttemptId { get; init; } = "";
    public string AccessToken { get; set; } = "";
    public string ApiBaseUrl { get; init; } = "";
    public DateTimeOffset StartedAt { get; init; }
    public SessionStatus Status { get; set; } = SessionStatus.Active;
    public string? CloseReason { get; set; }
}
