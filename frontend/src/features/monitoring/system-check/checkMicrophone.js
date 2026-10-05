// Permission check ke turant baad saare tracks stop. createPermissionMonitor checkCamera.js me hai.
export async function checkMicrophone() {
  const md = typeof navigator !== 'undefined' ? navigator.mediaDevices : null;
  if (!md || !md.getUserMedia) return { status: 'FAIL', message: 'Microphone access is not supported in this browser.' };
  let stream;
  try {
    stream = await md.getUserMedia({ audio: true });
    return { status: 'PASS', message: 'Microphone is working.' };
  } catch (e) {
    if (e && e.name === 'NotAllowedError') return { status: 'FAIL', message: 'Microphone permission denied. Allow microphone access in your browser settings.' };
    if (e && e.name === 'NotFoundError') return { status: 'FAIL', message: 'No microphone device found.' };
    return { status: 'WARN', message: 'Could not check the microphone. Make sure no other app is using it.' };
  } finally {
    if (stream) stream.getTracks().forEach((t) => t.stop());
  }
}
