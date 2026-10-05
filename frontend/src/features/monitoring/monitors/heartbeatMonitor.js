import { EVENT_TYPES as T } from '../events/eventTypes.js';
import { heartbeat as defaultHeartbeat } from '../../../api/attemptApi.js';

const MAX_BACKOFF_MS = 30000;
const REQUEST_TIMEOUT_MS = 8000;
export const TERMINAL_STATUSES = new Set(['SUBMITTED', 'AUTO_SUBMITTED', 'TERMINATED']);

// Heartbeat API error code => terminal attempt status (shell ko batane ke liye)
const CODE_TO_STATUS = {
  ATTEMPT_ALREADY_SUBMITTED: 'SUBMITTED',
  ATTEMPT_EXPIRED: 'AUTO_SUBMITTED',
  ATTEMPT_NOT_ACTIVE: 'TERMINATED',
};
export const terminalStatusFromError = (err) => (err && CODE_TO_STATUS[err.code]) || null;

function withTimeout(promise, ms) {
  let t;
  const timeout = new Promise((_, rej) => { t = setTimeout(() => rej(new Error('HEARTBEAT_TIMEOUT')), ms); });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(t));
}

// Session alive proof hai, honesty ka nahi. 2 consecutive failures => ek baar HEARTBEAT_MISSED.
export function createHeartbeatMonitor(report, {
  attemptId, intervalMs = 15000, heartbeatFn = defaultHeartbeat, onServerTime, onAttemptStatus, random = Math.random,
} = {}) {
  let failures = 0;
  let missedReported = false;
  let timer = null;
  let stopped = false;

  const nextDelay = () => {
    const base = failures > 0 ? Math.min(intervalMs * 2 ** failures, MAX_BACKOFF_MS) : intervalMs;
    const jittered = base * (1 + (random() * 0.2 - 0.1)); // ±10%
    return failures > 0 ? Math.min(jittered, MAX_BACKOFF_MS) : jittered;
  };

  const schedule = () => { if (!stopped) timer = setTimeout(tick, nextDelay()); };

  async function tick() {
    timer = null;
    try {
      const data = (await withTimeout(Promise.resolve(heartbeatFn(attemptId)), REQUEST_TIMEOUT_MS)) || {};
      if (stopped) return;
      failures = 0;
      missedReported = false;
      if (onServerTime) onServerTime(data.serverTime, data.expiresAt);
      if (onAttemptStatus && data.attemptStatus) onAttemptStatus(data.attemptStatus);
      if (TERMINAL_STATUSES.has(data.attemptStatus)) return; // aage heartbeat ki zaroorat nahi
    } catch (err) {
      if (stopped) return;
      const status = terminalStatusFromError(err);
      if (status) { if (onAttemptStatus) onAttemptStatus(status); return; }
      failures += 1;
      if (failures >= 2 && !missedReported) {
        missedReported = true;
        report(T.HEARTBEAT_MISSED, { consecutiveFailures: failures });
      }
    }
    schedule();
  }

  schedule();
  return () => { stopped = true; if (timer) { clearTimeout(timer); timer = null; } };
}
