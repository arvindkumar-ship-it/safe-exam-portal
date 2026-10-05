import { resolvePolicy } from '../policy.js';
import { checkBrowser, checkStorage } from './checkBrowser.js';
import { checkFullscreen } from './checkFullscreen.js';
import { checkNetwork } from './checkNetwork.js';
import { checkCamera } from './checkCamera.js';
import { checkMicrophone } from './checkMicrophone.js';

// passed = koi FAIL nahi. WARN exam rokta nahi.
export async function runSystemCheck({ policy, healthFn, browserOpts } = {}) {
  const p = resolvePolicy(policy);
  const checks = [
    { id: 'javascript', label: 'JavaScript', status: 'PASS', message: 'JavaScript is enabled.' },
    checkBrowser(browserOpts),
    await checkStorage(),
    checkFullscreen({ policy: p }),
    await checkNetwork(healthFn ? { healthFn } : {}),
  ];
  const w = typeof window !== 'undefined' ? window : { innerWidth: 0, innerHeight: 0 };
  checks.push(w.innerWidth >= 1024 && w.innerHeight >= 600
    ? { id: 'resolution', label: 'Screen size', status: 'PASS', message: `${w.innerWidth}×${w.innerHeight} is fine.` }
    : { id: 'resolution', label: 'Screen size', status: 'WARN', message: 'Your window is small. Use at least 1024×600 for a comfortable exam.' });
  if (p.camera) checks.push({ id: 'camera', label: 'Camera', ...(await checkCamera()) });
  if (p.microphone) checks.push({ id: 'microphone', label: 'Microphone', ...(await checkMicrophone()) });
  checks.push({ id: 'extensions', label: 'Browser extensions', status: 'WARN', message: 'Disable browser extensions that read page content' });
  return { passed: !checks.some((c) => c.status === 'FAIL'), checks };
}
