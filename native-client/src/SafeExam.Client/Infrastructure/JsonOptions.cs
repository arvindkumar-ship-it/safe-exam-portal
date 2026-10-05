using System.Text.Json;

namespace SafeExam.Client.Infrastructure;

public static class Json
{
    /// camelCase + case-insensitive read (server contract).
    public static readonly JsonSerializerOptions Options = new(JsonSerializerDefaults.Web);
}
