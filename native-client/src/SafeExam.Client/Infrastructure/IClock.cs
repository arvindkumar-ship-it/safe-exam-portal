using System.Globalization;

namespace SafeExam.Client.Infrastructure;

/// Time sirf yahin se aata hai (UTC). Tests me fake clock inject hota hai.
public interface IClock { DateTimeOffset UtcNow { get; } }

public sealed class SystemClock : IClock
{
    public DateTimeOffset UtcNow => DateTimeOffset.UtcNow;
}

public static class ClockExtensions
{
    /// Server contract format: 2026-10-04T18:40:00.000Z
    public static string ToIso(this DateTimeOffset t) =>
        t.UtcDateTime.ToString("yyyy-MM-dd'T'HH:mm:ss.fff'Z'", CultureInfo.InvariantCulture);
}
