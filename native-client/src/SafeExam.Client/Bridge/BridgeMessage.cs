using System.Text;
using System.Text.Json;
using SafeExam.Client.Infrastructure;

namespace SafeExam.Client.Bridge;

public static class BridgeCommands
{
    public const string GetClientVersion = "getClientVersion";
    public const string GetSessionStatus = "getSessionStatus";
    public const string ReportNativeEvent = "reportNativeEvent";   // native -> JS push
    public const string RequestExit = "requestExit";
}

public static class BridgeErrors
{
    public const string OriginNotAllowed = "ORIGIN_NOT_ALLOWED";
    public const string UnknownCommand = "UNKNOWN_COMMAND";
    public const string BadRequest = "BAD_REQUEST";
    // extras
    public const string ReplayRejected = "REPLAY_REJECTED";
    public const string BindRejected = "BIND_REJECTED";
    public const string ExitDenied = "EXIT_DENIED";
}

/// native -> JS transport (WebView2: CoreWebView2.PostWebMessageAsJson). Tests me fake.
public interface IBridgeTransport { void PostJson(string json); }

public static class BridgeReply
{
    /// idRaw = request id ka raw JSON ("\"abc\"" ya "12") — page ke saath same type me echo hota hai.
    public static string Build(string? idRaw, bool ok, object? data = null, string? error = null)
    {
        using var ms = new MemoryStream();
        using (var w = new Utf8JsonWriter(ms))
        {
            w.WriteStartObject();
            w.WritePropertyName("id");
            if (idRaw == null) w.WriteNullValue(); else w.WriteRawValue(idRaw);
            w.WriteBoolean("ok", ok);
            if (data != null) { w.WritePropertyName("data"); JsonSerializer.Serialize(w, data, Json.Options); }
            if (error != null) w.WriteString("error", error);
            w.WriteEndObject();
        }
        return Encoding.UTF8.GetString(ms.ToArray());
    }
}
