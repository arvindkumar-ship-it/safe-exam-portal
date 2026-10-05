import { EVENT_TYPES as T } from '../events/eventTypes.js';

// Permission check ke turant baad saare tracks stop (recording nahi hoti).
export async function checkCamera() {
  const md = typeof navigator !== 'undefined' ? navigator.mediaDevices : null;
  if (!md || !md.getUserMedia) return { status: 'FAIL', message: 'Camera access is not supported in this browser.' };
  let stream;
  try {
    stream = await md.getUserMedia({ video: true });
    return { status: 'PASS', message: 'Camera is working.' };
  } catch (e) {
    if (e && e.name === 'NotAllowedError') return { status: 'FAIL', message: 'Camera permission denied. Allow camera access in your browser settings.' };
    if (e && e.name === 'NotFoundError') return { status: 'FAIL', message: 'No camera device found.' };
    return { status: 'WARN', message: 'Could not check the camera. Make sure no other app is using it.' };
  } finally {
    if (stream) stream.getTracks().forEach((t) => t.stop());
  }
}

// Runtime me permission revoke detect (camera/microphone dono yahin).
export function createPermissionMonitor(report, { camera = false, microphone = false } = {}) {
  if (typeof navigator === 'undefined' || !navigator.permissions || !navigator.permissions.query) return () => {};
  let cancelled = false;
  const statuses = [];
  const watch = (name, type) => {
    Promise.resolve(navigator.permissions.query({ name })).then((st) => {
      if (cancelled || !st) { return; }
      st.onchange = () => report(type, { state: st.state });
      statuses.push(st);
    }).catch(() => {}); // browser is permission ko support nahi karta
  };
  if (camera) watch('camera', T.CAMERA_PERMISSION_CHANGED);
  if (microphone) watch('microphone', T.MICROPHONE_PERMISSION_CHANGED);
  return () => { cancelled = true; statuses.forEach((s) => { s.onchange = null; }); };
}
