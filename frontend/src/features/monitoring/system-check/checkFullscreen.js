export function checkFullscreen({ policy } = {}) {
  const base = { id: 'fullscreen', label: 'Fullscreen' };
  const ok = typeof document !== 'undefined' && !!document.documentElement.requestFullscreen;
  if (ok) return { ...base, status: 'PASS', message: 'Fullscreen is available.' };
  if (policy && policy.fullscreen === false) return { ...base, status: 'PASS', message: 'Fullscreen is not required for this exam.' };
  return { ...base, status: 'WARN', message: 'Fullscreen is not available in this browser. You can continue; this will be noted for review.' };
}
