import { apiRequest } from '../../../api/client.js';

const SLOW_MS = 800;

// 3 x GET /health. avg RTT > 800ms => WARN, koi bhi fail => FAIL.
export async function checkNetwork({ healthFn = () => apiRequest('/health'), now = () => performance.now() } = {}) {
  const base = { id: 'network', label: 'Network' };
  const times = [];
  try {
    for (let i = 0; i < 3; i += 1) {
      const t0 = now();
      await healthFn();
      times.push(now() - t0);
    }
  } catch {
    return { ...base, status: 'FAIL', message: 'Cannot reach the exam server. Check your internet connection and try again.' };
  }
  const avg = Math.round(times.reduce((a, b) => a + b, 0) / times.length);
  if (avg > SLOW_MS) return { ...base, status: 'WARN', message: `Your connection is slow (${avg} ms). The exam can run, but a faster network is better.` };
  return { ...base, status: 'PASS', message: `Connection is good (${avg} ms).` };
}
