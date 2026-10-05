// Canonical WEB event types (frozen list, value = key). Naya type yahan add mat karo.
const WEB_TYPES = [
  'PAGE_HIDDEN', 'PAGE_VISIBLE', 'WINDOW_BLUR', 'WINDOW_FOCUS',
  'FULLSCREEN_ENTERED', 'FULLSCREEN_EXIT', 'FULLSCREEN_UNAVAILABLE',
  'CLIPBOARD_ATTEMPT', 'COPY_SHORTCUT', 'PASTE_SHORTCUT', 'DEVTOOLS_SHORTCUT', 'PRINT_SHORTCUT', 'CONTEXT_MENU_ATTEMPT',
  'NETWORK_DISCONNECTED', 'NETWORK_RECONNECTED', 'HEARTBEAT_MISSED',
  'CAMERA_PERMISSION_CHANGED', 'MICROPHONE_PERMISSION_CHANGED',
];

export const EVENT_TYPES = Object.freeze(Object.fromEntries(WEB_TYPES.map((t) => [t, t])));

export function isWebEventType(t) {
  return typeof t === 'string' && Object.prototype.hasOwnProperty.call(EVENT_TYPES, t);
}
