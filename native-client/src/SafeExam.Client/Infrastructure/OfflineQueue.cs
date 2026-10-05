using System.Text.Json;

namespace SafeExam.Client.Infrastructure;

/// C-15: append-only encrypted segment (har record protected). Restart par load; corrupt record skip + log.
public sealed class OfflineQueue
{
    public const int DefaultCap = 10_000;
    private readonly LocalStore _store;
    private readonly string _name;
    private readonly AppLogger _log;
    private readonly int _cap;
    private readonly object _lock = new();
    private readonly List<NativeEvent> _events = new();
    private readonly HashSet<long> _seqs = new();

    public long LastSequence { get; private set; }
    public int DroppedForCap { get; private set; }

    public OfflineQueue(LocalStore store, string name = "events.queue", AppLogger? log = null, int cap = DefaultCap)
    {
        _store = store; _name = name; _log = log ?? AppLogger.Null; _cap = cap;
        Load();
    }

    private string SeqName => _name + ".seq";

    private void Load()
    {
        var records = _store.ReadRecords(_name, out var corrupted);
        if (corrupted > 0) _log.Warn("offline queue: corrupted records skipped", ("count", corrupted));
        foreach (var r in records)
        {
            try
            {
                var e = JsonSerializer.Deserialize<NativeEvent>(r, Json.Options);
                if (e != null && _seqs.Add(e.ClientSequence)) { _events.Add(e); LastSequence = Math.Max(LastSequence, e.ClientSequence); }
            }
            catch (JsonException) { _log.Warn("offline queue: bad record skipped"); }
        }
        // ack ho chuke events ke baad bhi sequence peeche na jaye
        var persisted = _store.Read(SeqName);
        if (persisted != null && long.TryParse(System.Text.Encoding.ASCII.GetString(persisted), out var p)) LastSequence = Math.Max(LastSequence, p);
    }

    public int Count { get { lock (_lock) return _events.Count; } }

    /// false => duplicate sequence ignore hua.
    public bool Enqueue(NativeEvent e)
    {
        lock (_lock)
        {
            if (!_seqs.Add(e.ClientSequence)) return false;
            _store.AppendRecord(_name, JsonSerializer.SerializeToUtf8Bytes(e, Json.Options));
            _events.Add(e);
            LastSequence = Math.Max(LastSequence, e.ClientSequence);
            if (_events.Count > _cap) EnforceCap();
            return true;
        }
    }

    public IReadOnlyList<NativeEvent> PeekBatch(int n)
    {
        lock (_lock) return _events.OrderBy(e => e.ClientSequence).Take(n).ToList();
    }

    /// Server ack (acknowledgedUpTo) ke baad: seq tak sab delete.
    public void RemoveUpTo(long seq)
    {
        lock (_lock)
        {
            if (_events.RemoveAll(e => e.ClientSequence <= seq) == 0) return;
            Persist();
        }
    }

    /// Extra: server ne batch ko respond kiya (accepted/duplicate/permanent-reject) => unka delete safe hai.
    public void RemoveSequences(IEnumerable<long> seqs)
    {
        lock (_lock)
        {
            var set = seqs.ToHashSet();
            if (_events.RemoveAll(e => set.Contains(e.ClientSequence)) == 0) return;
            Persist();
        }
    }

    public void Clear()
    {
        lock (_lock) { _events.Clear(); Persist(); }
    }

    private void Persist()
    {
        _store.ReplaceRecords(_name, _events.Select(e => JsonSerializer.SerializeToUtf8Bytes(e, Json.Options)));
        _store.Write(SeqName, System.Text.Encoding.ASCII.GetBytes(LastSequence.ToString()));
    }

    /// Cap: pehle sabse purana low-priority (INFO-level) event, warna sabse purana koi bhi.
    private void EnforceCap()
    {
        int dropped = 0;
        while (_events.Count > _cap)
        {
            var victim = _events.Where(e => Monitoring.NativeEventTypes.IsLowPriority(e.EventType)).OrderBy(e => e.ClientSequence).FirstOrDefault()
                         ?? _events.OrderBy(e => e.ClientSequence).First();
            _events.Remove(victim); dropped++;
        }
        DroppedForCap += dropped;
        _log.Warn("offline queue: cap reached, oldest dropped", ("dropped", dropped));
        Persist();
    }
}
