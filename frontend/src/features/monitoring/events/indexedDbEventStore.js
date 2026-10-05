import { openDb, reqP, txDone } from '../../../utils/idb.js';

const DB_NAME = 'safeexam-events';
const SRC = 'WEB_CLIENT';

// IndexedDB na chale toh yahi fallback (sirf session tak).
export function createMemoryStore() {
  const map = new Map();
  let last = 0;
  return {
    async put(e) { map.set(e.clientSequence, e); last = Math.max(last, e.clientSequence); },
    async all() { return [...map.values()].sort((a, b) => a.clientSequence - b.clientSequence); },
    async removeUpTo(seq) { for (const k of [...map.keys()]) if (k <= seq) map.delete(k); },
    async removeSequences(list) { list.forEach((s) => map.delete(s)); },
    async lastSequence() { return last; },
  };
}

export async function openEventStore(attemptId) {
  let db;
  try {
    db = await openDb(DB_NAME, 1, (d) => {
      d.createObjectStore('events', { keyPath: ['attemptId', 'source', 'clientSequence'] });
      d.createObjectStore('meta', { keyPath: 'attemptId' }); // last sequence yahan (ack ke baad bhi yaad rahe)
    });
  } catch { return createMemoryStore(); }

  const range = (from, to) => IDBKeyRange.bound([attemptId, SRC, from], [attemptId, SRC, to]);
  return {
    async put(event) {
      const tx = db.transaction(['events', 'meta'], 'readwrite');
      tx.objectStore('events').put({ attemptId, source: SRC, clientSequence: event.clientSequence, event });
      const meta = tx.objectStore('meta');
      const cur = await reqP(meta.get(attemptId));
      meta.put({ attemptId, last: Math.max((cur && cur.last) || 0, event.clientSequence) });
      await txDone(tx);
    },
    async all() {
      const rows = await reqP(db.transaction('events').objectStore('events').getAll(range(0, Infinity)));
      return rows.map((r) => r.event);
    },
    async removeUpTo(seq) {
      const tx = db.transaction('events', 'readwrite');
      tx.objectStore('events').delete(range(0, seq));
      await txDone(tx);
    },
    async removeSequences(list) {
      const tx = db.transaction('events', 'readwrite');
      list.forEach((s) => tx.objectStore('events').delete([attemptId, SRC, s]));
      await txDone(tx);
    },
    async lastSequence() {
      const m = await reqP(db.transaction('meta').objectStore('meta').get(attemptId));
      return (m && m.last) || 0;
    },
  };
}
