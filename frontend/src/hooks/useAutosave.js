import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createAnswerQueue, saveAnswerWithConflict } from '../features/monitoring/offline/answerQueue.js';
import { useOnlineStatus } from './useOnlineStatus.js';

// saveFn(questionId, { answerValue, version }) -> { version? }
// status: IDLE | SAVING | SAVED | FAILED | OFFLINE
export function useAutosave({ attemptId, saveFn, debounceMs = 600, initialVersions = {} }) {
  const online = useOnlineStatus();
  const [status, setStatus] = useState('IDLE');
  const versions = useRef({ ...initialVersions }); // resume: server ka version se start
  const pending = useRef(new Map());
  const timer = useRef(null);
  const retryTimer = useRef(null);
  const retries = useRef(0);
  const saveRef = useRef(saveFn);
  saveRef.current = saveFn;
  const onlineRef = useRef(online);
  onlineRef.current = online;
  const queue = useMemo(() => createAnswerQueue(attemptId), [attemptId]);

  const flushQueue = useCallback(async () => {
    clearTimeout(retryTimer.current);
    if (!queue.size()) return true;
    const r = await queue.flush((q, body) => saveRef.current(q, body), versions.current);
    if (r.remaining) {
      setStatus('FAILED');
      const delay = Math.min(1000 * 2 ** retries.current++, 30000);
      retryTimer.current = setTimeout(() => { if (onlineRef.current) flushQueue(); }, delay);
      return false;
    }
    retries.current = 0;
    setStatus('SAVED');
    return true;
  }, [queue]);

  const flushPending = useCallback(async () => {
    clearTimeout(timer.current);
    await queue.load();
    const entries = [...pending.current.entries()];
    pending.current.clear();
    if (!entries.length) return;
    if (!onlineRef.current) {
      for (const [q, v] of entries) await queue.enqueue(q, v);
      setStatus('OFFLINE');
      return;
    }
    setStatus('SAVING');
    let failed = false;
    for (const [q, v] of entries) {
      // Queue me purani value ho toh direct save nahi (order/latest-wins bachane ke liye).
      if (queue.size() > 0 || failed) { await queue.enqueue(q, v); continue; }
      try {
        await saveAnswerWithConflict((qq, body) => saveRef.current(qq, body), q, v, versions.current);
      } catch {
        failed = true;
        await queue.enqueue(q, v);
      }
    }
    if (queue.size() > 0) await flushQueue();
    else setStatus('SAVED');
  }, [queue, flushQueue]);

  const queueAnswer = useCallback((questionId, answerValue) => {
    pending.current.set(String(questionId), answerValue);
    clearTimeout(timer.current);
    if (!onlineRef.current) { flushPending(); return; } // offline: turant encrypted queue me
    setStatus('SAVING');
    timer.current = setTimeout(flushPending, debounceMs);
  }, [flushPending, debounceMs]);

  const retryNow = useCallback(async () => {
    await flushPending();
    return flushQueue();
  }, [flushPending, flushQueue]);

  // Mount par purana (restart ke baad) queue load karo.
  useEffect(() => {
    let alive = true;
    queue.load().then(() => {
      if (!alive || !queue.size()) return;
      if (onlineRef.current) flushQueue(); else setStatus('OFFLINE');
    });
    return () => { alive = false; clearTimeout(timer.current); clearTimeout(retryTimer.current); };
  }, [queue, flushQueue]);

  // Connectivity change.
  useEffect(() => {
    if (!online) { setStatus('OFFLINE'); return; }
    setStatus((s) => (s === 'OFFLINE' ? 'IDLE' : s));
    if (queue.size()) flushQueue();
  }, [online, queue, flushQueue]);

  const clearLocal = useCallback(async () => { pending.current.clear(); await queue.clear(); }, [queue]);

  return { status, queueAnswer, retryNow, versions: versions.current, clearLocal };
}
