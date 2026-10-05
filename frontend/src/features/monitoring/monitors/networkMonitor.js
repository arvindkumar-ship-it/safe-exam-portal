import { EVENT_TYPES as T } from '../events/eventTypes.js';

// online/offline. Network issue cheating nahi hai — sirf report + status.
export function createNetworkMonitor(report, { onChange } = {}) {
  if (onChange) onChange(navigator.onLine !== false);
  const off = () => { if (onChange) onChange(false); report(T.NETWORK_DISCONNECTED, {}); };
  const on = () => { if (onChange) onChange(true); report(T.NETWORK_RECONNECTED, {}); };
  window.addEventListener('offline', off);
  window.addEventListener('online', on);
  return () => {
    window.removeEventListener('offline', off);
    window.removeEventListener('online', on);
  };
}
