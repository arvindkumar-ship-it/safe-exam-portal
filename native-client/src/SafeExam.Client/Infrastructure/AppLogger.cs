using System.Globalization;
using System.Text;

namespace SafeExam.Client.Infrastructure;

/// Structured one-line logger. R7: token/password/code/window title/clipboard values kabhi log nahi hote.
public sealed class AppLogger
{
    // normalized keys (lowercase, '_' '-' hata ke) jinki value mask hoti hai
    private static readonly HashSet<string> Masked = new()
    {
        "token", "accesstoken", "refreshtoken", "password", "code", "exitcode", "secret",
        "authorization", "title", "windowtitle", "clipboard", "clipboardtext", "answer"
    };

    private readonly Action<string> _write;
    private readonly IClock _clock;
    private readonly object _lock = new();

    public AppLogger(Action<string> writeLine, IClock clock) { _write = writeLine; _clock = clock; }

    public static AppLogger Null => new(_ => { }, new SystemClock());

    /// client-YYYYMMDD.log me append; logging kabhi app ko crash nahi karta.
    public static AppLogger ToFile(IClock clock, string logDir)
    {
        return new AppLogger(line =>
        {
            try
            {
                Directory.CreateDirectory(logDir);
                var name = $"client-{clock.UtcNow.UtcDateTime:yyyyMMdd}.log";
                File.AppendAllText(Path.Combine(logDir, name), line + Environment.NewLine);
            }
            catch { /* ignore */ }
        }, clock);
    }

    public void Info(string msg, params (string k, object? v)[] fields) => Write("INFO", msg, fields);
    public void Warn(string msg, params (string k, object? v)[] fields) => Write("WARN", msg, fields);
    public void Error(string msg, params (string k, object? v)[] fields) => Write("ERROR", msg, fields);

    private void Write(string level, string msg, (string k, object? v)[] fields)
    {
        var sb = new StringBuilder();
        sb.Append(_clock.UtcNow.ToIso()).Append(' ').Append(level).Append(' ').Append(Clean(msg));
        foreach (var (k, v) in fields)
        {
            sb.Append(' ').Append(Clean(k)).Append('=');
            sb.Append(IsMasked(k) ? "***" : Format(v));
        }
        lock (_lock) { try { _write(sb.ToString()); } catch { /* ignore */ } }
    }

    public static bool IsMasked(string key) =>
        Masked.Contains(key.Replace("_", "").Replace("-", "").ToLowerInvariant());

    private static string Format(object? v)
    {
        var s = v switch
        {
            null => "null",
            IFormattable f => f.ToString(null, CultureInfo.InvariantCulture),
            _ => v.ToString() ?? ""
        };
        s = Clean(s);
        if (s.Length > 300) s = s[..300] + "...";
        return s.Contains(' ') ? "\"" + s + "\"" : s;
    }

    private static string Clean(string s) => s.Replace('\r', ' ').Replace('\n', ' ');
}
