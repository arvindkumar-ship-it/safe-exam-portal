import { sendEvents as defaultSend } from '../../../api/eventApi.js';

const MAX_BACKOFF_MS = 30000;
const TERMINAL_CODES = new Set(['ATTEMPT_NOT_ACTIVE', 'ATTEMPT_ALREADY_SUBMITTED', 'ATTEMPT_EXPIRED']);
const isPermanent = (code) => typeof code === 'string' && code.startsWith('EVENT_');

export function createEventUploader({ queue, attemptId, sendEvents = defaultSend, intervalMs = 5000, batchSize = 20, onUploaded } = {}) {
  let timer = null;
  let running = false;
  let backoffMs = 0;
  let terminal = false;
  let lock = Promise.resolve();

  // Ek batch bhejo. Return: 'empty' | 'ok' | 'retry' | 'stop'
  async function uploadOnce() {
    const batch = await queue.getBatch(batchSize);
    if (!batch.length) return 'empty';
    const sizeBefore = queue.size();
    try {
      const res = (await sendEvents(attemptId, batch)) || {};
      const rejected = Array.isArray(res.rejected) ? res.rejected : [];
      const permanent = rejected.filter((r) => isPermanent(r.code)).map((r) => r.clientSequence);
      if (typeof res.acknowledgedUpTo === 'number') await queue.removeUpTo(res.acknowledgedUpTo);
      if (permanent.length) {
        await queue.removeSequences(permanent);
        console.warn('[monitoring] dropped rejected events', permanent.length); // non-sensitive log
      }
      if (onUploaded) onUploaded(res);
      // Progress guard: server ne kuch ack/reject nahi kiya => hot loop nahi, backoff karke retry.
      if (queue.size() >= sizeBefore) return failWithBackoff();
      backoffMs = 0;
      return 'ok';
    } catch (err) {
      const code = err && err.code;
      if (TERMINAL_CODES.has(code)) { terminal = true; return 'stop'; }
      if (isPermanent(code)) { // poora batch invalid
        await queue.removeSequences(batch.map((e) => e.clientSequence));
        return 'ok';
      }
      return failWithBackoff();
    }
  }

  function failWithBackoff() {
    backoffMs = backoffMs ? Math.min(backoffMs * 2, MAX_BACKOFF_MS) : 1000; // 1s,2s,4s..30s
    return 'retry';
  }

  // Queue khali hone tak bhejo; failure par ruk jao. Serialized (parallel flush nahi).
  function flush() {
    const run = lock.then(async () => {
      for (;;) {
        const r = await uploadOnce();
        if (r === 'empty') return true;
        if (r !== 'ok') return false;
      }
    });
    lock = run.catch(() => {});
    return run;
  }

  function schedule() {
    if (!running) return;
    timer = setTimeout(async () => {
      timer = null;
      await flush();
      if (terminal) { running = false; return; }
      schedule();
    }, backoffMs || intervalMs);
  }

  return {
    start() { if (running) return; running = true; terminal = false; schedule(); },
    stop() { running = false; if (timer) { clearTimeout(timer); timer = null; } },
    flush,
    // Extra: queue batchSize tak pahunche toh turant bhejo.
    notify() { if (running && !backoffMs && queue.size() >= batchSize) flush(); },
    isTerminal: () => terminal,
  };
}
