// WebView2 bridge (Product C native client). Normal browser me sab no-op / null.
const TIMEOUT_MS = 5000;
let nextId = 1;

export function isNativeClient() {
  return typeof window !== 'undefined' && !!(window.chrome && window.chrome.webview);
}

function request(command, payload) {
  return new Promise((resolve, reject) => {
    const wv = window.chrome.webview;
    const id = nextId++;
    const timer = setTimeout(() => { wv.removeEventListener('message', onMsg); reject(new Error('NATIVE_TIMEOUT')); }, TIMEOUT_MS);
    function onMsg(e) {
      const msg = e && e.data;
      if (!msg || msg.id !== id) return;
      clearTimeout(timer);
      wv.removeEventListener('message', onMsg);
      resolve(msg);
    }
    wv.addEventListener('message', onMsg);
    wv.postMessage({ id, command, payload });
  });
}

export async function bindNativeClient({ attemptId, accessToken }) {
  if (!isNativeClient()) return null;
  try {
    const reply = await request('getSessionStatus', { attemptId, accessToken });
    return reply.ok ? reply.data : null;
  } catch { return null; }
}

// Native -> JS push: { command: "reportNativeEvent", payload: { eventType, ... } }
export function onNativeEvent(cb) {
  if (!isNativeClient()) return () => {};
  const wv = window.chrome.webview;
  const handler = (e) => {
    const msg = e && e.data;
    if (msg && msg.command === 'reportNativeEvent') cb(msg.payload || {});
  };
  wv.addEventListener('message', handler);
  return () => wv.removeEventListener('message', handler);
}

export async function requestNativeExit(code) {
  if (!isNativeClient()) return { ok: false };
  try {
    const reply = await request('requestExit', { code });
    return { ok: !!reply.ok };
  } catch { return { ok: false }; }
}
