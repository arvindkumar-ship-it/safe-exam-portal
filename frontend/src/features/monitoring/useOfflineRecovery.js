import { useEffect, useRef, useState } from 'react';
import { TERMINAL_STATUSES, terminalStatusFromError } from './monitors/heartbeatMonitor.js';

export const backoffDelayMs = (n) => Math.min(1000 * 2 ** n, 30000); // 1,2,4..30s
export const OFFLINE_MESSAGE = 'Offline — answers are saved on this device';
export const CLOSED_MESSAGE = 'This attempt was already closed by the server. Answers saved on this device were discarded.';

// Reconnect order (fixed): 1) heartbeat sync 2) answers flush 3) events flush.
// Grace se zyada offline => sirf banner escalate. Kabhi terminate nahi; server expiry authoritative.
export function useOfflineRecovery({ online, graceSeconds = 300, heartbeat, onServerTime, flushAnswers, flushEvents, discardAnswers, onTerminal }) {
  const [offlineSeconds, setOfflineSeconds] = useState(0);
  const [recovering, setRecovering] = useState(false);
  const [notice, setNotice] = useState(null);
  const wasOffline = useRef(!online);
  const cb = useRef({});
  cb.current = { heartbeat, onServerTime, flushAnswers, flushEvents, discardAnswers, onTerminal };

  useEffect(() => {
    if (online) { setOfflineSeconds(0); return undefined; }
    const id = setInterval(() => setOfflineSeconds((s) => s + 1), 1000);
    return () => clearInterval(id);
  }, [online]);

  useEffect(() => {
    if (!online) { wasOffline.current = true; return undefined; }
    if (!wasOffline.current) return undefined;
    let cancelled = false;
    let timer = null;
    let attempt = 0;

    const closeAttempt = async (status) => {
      await (cb.current.discardAnswers && cb.current.discardAnswers());
      setNotice(CLOSED_MESSAGE);
      wasOffline.current = false;
      setRecovering(false);
      if (cb.current.onTerminal) cb.current.onTerminal(status);
    };

    const run = async () => {
      setRecovering(true);
      try {
        const hb = (await cb.current.heartbeat()) || {};
        if (cancelled) return;
        if (cb.current.onServerTime) cb.current.onServerTime(hb.serverTime, hb.expiresAt);
        if (TERMINAL_STATUSES.has(hb.attemptStatus)) { await closeAttempt(hb.attemptStatus); return; }
        await (cb.current.flushAnswers && cb.current.flushAnswers());
        await (cb.current.flushEvents && cb.current.flushEvents());
        if (cancelled) return;
        wasOffline.current = false;
        setRecovering(false);
      } catch (err) {
        if (cancelled) return;
        const status = terminalStatusFromError(err);
        if (status) { await closeAttempt(status); return; }
        timer = setTimeout(run, backoffDelayMs(attempt++));
      }
    };
    run();
    return () => { cancelled = true; clearTimeout(timer); };
  }, [online]);

  const escalated = !online && offlineSeconds > graceSeconds;
  const bannerMessage = online ? null
    : escalated ? `${OFFLINE_MESSAGE}. You have been offline for over ${Math.floor(graceSeconds / 60)} minutes. Your exam is not ended; reconnect to sync your answers.`
      : OFFLINE_MESSAGE;
  return { offline: !online, offlineSeconds, escalated, recovering, notice, bannerMessage };
}
