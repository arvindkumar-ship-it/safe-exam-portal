import { openDb, reqP, txDone } from '../../../utils/idb.js';
import { encryptJson, decryptJson } from './cryptoStore.js';

// Raw answers kabhi localStorage me nahi. IndexedDB me sirf encrypted blob.
export const isVersionConflict = (err) => !!err && (err.code === 'ANSWER_VERSION_CONFLICT' || err.code === 'VERSION_CONFLICT' || err.status === 409);
export const serverVersionFrom = (err) => {
  const d = (err && err.details) || {};
  return typeof d.version === 'number' ? d.version : typeof d.currentVersion === 'number' ? d.currentVersion : undefined;
};

// Ek answer save: version conflict par server version adopt karke ek baar retry.
export async function saveAnswerWithConflict(saveFn, questionId, answerValue, versions) {
  const send = async () => {
    const version = versions[questionId] ?? 0;
    const res = await saveFn(questionId, { answerValue, version });
    versions[questionId] = res && typeof res.version === 'number' ? res.version : version + 1;
    return versions[questionId];
  };
  try {
    return await send();
  } catch (err) {
    if (!isVersionConflict(err)) throw err;
    const sv = serverVersionFrom(err);
    if (typeof sv === 'number') versions[questionId] = sv;
    return send();
  }
}

export function createAnswerQueue(attemptId) {
  const items = new Map(); // questionId -> { answerValue, seq }
  let seq = 0;
  let dbPromise = null;
  let loaded = null;

  const getDb = () => {
    if (!dbPromise) {
      dbPromise = openDb('safeexam-answers', 1, (d) => d.createObjectStore('answers', { keyPath: ['attemptId', 'questionId'] })).catch(() => null);
    }
    return dbPromise;
  };
  const range = () => IDBKeyRange.bound([attemptId, ''], [attemptId, '\uffff']);

  function load() {
    if (!loaded) {
      loaded = (async () => {
        const db = await getDb();
        if (!db) return;
        const rows = await reqP(db.transaction('answers').objectStore('answers').getAll(range()));
        for (const r of rows) {
          try {
            const v = await decryptJson(r.blob);
            if (!items.has(r.questionId)) items.set(r.questionId, { answerValue: v.answerValue, seq: r.seq });
            seq = Math.max(seq, r.seq);
          } catch { /* corrupt record skip */ }
        }
      })();
    }
    return loaded;
  }

  async function persist(questionId, answerValue, s) {
    try {
      const db = await getDb();
      if (!db) return;
      const blob = await encryptJson({ answerValue });
      const tx = db.transaction('answers', 'readwrite');
      tx.objectStore('answers').put({ attemptId, questionId, blob, seq: s });
      await txDone(tx);
    } catch { /* persistence best-effort, plaintext kabhi nahi */ }
  }

  async function unpersist(questionId) {
    try {
      const db = await getDb();
      if (!db) return;
      const tx = db.transaction('answers', 'readwrite');
      tx.objectStore('answers').delete([attemptId, questionId]);
      await txDone(tx);
    } catch { /* ignore */ }
  }

  return {
    load,
    // Latest value wins per question.
    async enqueue(questionId, answerValue) {
      await load();
      const q = String(questionId);
      const s = ++seq;
      items.set(q, { answerValue, seq: s });
      await persist(q, answerValue, s);
    },
    // Sequential flush (enqueue order). Pehli failure par ruk jao, baaki queue me rehta hai.
    async flush(saveFn, versions = {}) {
      await load();
      const order = [...items.entries()].sort((a, b) => a[1].seq - b[1].seq);
      let flushed = 0;
      for (const [q, entry] of order) {
        try {
          await saveAnswerWithConflict(saveFn, q, entry.answerValue, versions);
        } catch { break; }
        if (items.get(q) && items.get(q).seq === entry.seq) { items.delete(q); await unpersist(q); }
        flushed += 1;
      }
      return { flushed, remaining: items.size };
    },
    size: () => items.size,
    has: (q) => items.has(String(q)),
    async clear() {
      await load();
      const keys = [...items.keys()];
      items.clear();
      await Promise.all(keys.map(unpersist));
    },
  };
}
