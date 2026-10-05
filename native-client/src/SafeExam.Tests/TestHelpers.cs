using SafeExam.Client.Config;
using SafeExam.Client.Infrastructure;

namespace SafeExam.Tests;

public sealed class FakeClock : IClock
{
    public DateTimeOffset UtcNow { get; set; } = new(2026, 10, 5, 12, 0, 0, TimeSpan.Zero);
    public void Advance(TimeSpan t) => UtcNow += t;
}

public static class TestConfig
{
    public static ExamConfig Valid(FakeClock c) => new()
    {
        Version = 1,
        IssuedAt = c.UtcNow.AddHours(-1),
        ExpiresAt = c.UtcNow.AddDays(1),
        ExamUrl = "https://exam.example.com/exam/abc",
        AllowedHosts = new[] { "exam.example.com" },
        ApiBaseUrl = "https://api.example.com",
        ProhibitedProcesses = new[] { "teamviewer", "anydesk" },
        AccessibilityAllowedProcesses = new[] { "narrator", "nvda" },
    };
}
