// Feature detection pehle; UA sirf display ke liye.
function parseUa(ua = '') {
  const pick = (re, name) => { const m = ua.match(re); return m ? { name, version: m[1] } : null; };
  return pick(/Edg\/([\d.]+)/, 'Edge') || pick(/OPR\/([\d.]+)/, 'Opera') || pick(/Firefox\/([\d.]+)/, 'Firefox')
    || pick(/Chrome\/([\d.]+)/, 'Chrome') || (/Safari\//.test(ua) ? pick(/Version\/([\d.]+)/, 'Safari') : null)
    || { name: 'Unknown', version: '' };
}

export function getBrowserSupport({
  win = typeof window !== 'undefined' ? window : {},
  doc = typeof document !== 'undefined' ? document : null,
  ua = typeof navigator !== 'undefined' ? navigator.userAgent : '',
} = {}) {
  const required = {
    fetch: typeof win.fetch === 'function',
    WebSocket: typeof win.WebSocket !== 'undefined',
    IndexedDB: !!win.indexedDB,
    'crypto.subtle': !!(win.crypto && win.crypto.subtle), // sirf secure context (HTTPS) me
  };
  const fsEl = doc && doc.documentElement;
  const fullscreen = !!(fsEl && fsEl.requestFullscreen);
  const missing = Object.entries(required).filter(([, ok]) => !ok).map(([k]) => k);
  if (!fullscreen) missing.push('Fullscreen API');
  // Fullscreen na ho toh exam degrade hota hai, block nahi.
  const supported = Object.values(required).every(Boolean);
  return { supported, missing, browser: parseUa(ua) };
}
