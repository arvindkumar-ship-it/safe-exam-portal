using System.Diagnostics;
using SafeExam.Client.Config;
using SafeExam.Client.Infrastructure;

namespace SafeExam.Client.Monitoring;

/// Mockable. Dhyan do: Kill/Stop jaisa koi method yahan nahi hai (R3: event-only).
public interface IProcessProvider { IReadOnlyCollection<string> GetProcessNames(); }

public sealed class SystemProcessProvider : IProcessProvider
{
    public IReadOnlyCollection<string> GetProcessNames()
    {
        var names = new List<string>();
        foreach (var p in Process.GetProcesses())
        {
            try { names.Add(p.ProcessName); } catch { /* access denied / exited */ } finally { p.Dispose(); }
        }
        return names;
    }
}

/// C-07: har 5 s process list vs prohibitedProcesses. Naya process => ek baar UNAUTHORIZED_PROCESS.
public sealed class ProcessMonitor : IMonitor, IDisposable
{
    private readonly IProcessProvider _provider;
    private readonly INativeEventSink _sink;
    private readonly List<ProcessRule> _rules;
    private readonly AccessibilityPolicy _access;
    private readonly AppLogger _log;
    private readonly TimeSpan _interval;
    private readonly HashSet<string> _seen = new();
    private readonly object _lock = new();
    private bool _unavailableReported;
    private Timer? _timer;

    public ProcessMonitor(IProcessProvider provider, INativeEventSink sink, ExamConfig cfg, IClock clock,
        AccessibilityPolicy? access = null, AppLogger? log = null, TimeSpan? interval = null)
    {
        _provider = provider; _sink = sink;
        _rules = (cfg.ProhibitedProcesses ?? Array.Empty<string>()).Select(ProcessRule.Parse).ToList();
        _access = access ?? new AccessibilityPolicy(cfg);
        _log = log ?? AppLogger.Null;
        _interval = interval ?? TimeSpan.FromSeconds(5);
    }

    public string Name => "process";

    public void Start()
    {
        PollOnce();
        _timer ??= new Timer(_ => PollOnce(), null, _interval, _interval);
    }

    public void Stop() { _timer?.Dispose(); _timer = null; }
    public void Dispose() => Stop();

    public void PollOnce()
    {
        lock (_lock)
        {
            IReadOnlyCollection<string> names;
            try { names = _provider.GetProcessNames(); _unavailableReported = false; }
            catch (Exception e)
            {
                if (!_unavailableReported)
                {
                    _unavailableReported = true;
                    _log.Warn("process monitor unavailable", ("error", e.GetType().Name));
                    _sink.Report(NativeEventTypes.ProcessMonitorUnavailable);
                }
                return;
            }

            var present = new HashSet<string>();
            foreach (var raw in names)
            {
                var n = ProcessNames.Normalize(raw);
                if (n.Length == 0 || _access.IsAllowedProcess(n)) continue;   // accessibility tool kabhi report nahi
                if (_rules.Any(r => r.Matches(n))) present.Add(n);
            }
            foreach (var n in present)
                if (!_seen.Contains(n))
                    _sink.Report(NativeEventTypes.UnauthorizedProcess, new Dictionary<string, object?> { ["processName"] = n });
            _seen.Clear();
            foreach (var n in present) _seen.Add(n);   // band hua => agli baar phir report
        }
    }
}
