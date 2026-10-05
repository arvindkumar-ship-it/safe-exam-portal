import { EVENT_TYPES as T } from '../events/eventTypes.js';
import { isEditableTarget } from './domUtils.js';

// LIMITATION: ye sirf deterrent hai. Alternate keyboard, extension, OS tool ya external device
// se bypass possible hai. Security boundary nahi.
const MODIFIER_KEYS = new Set(['Control', 'Shift', 'Alt', 'Meta', 'AltGraph']);

function comboOf(e) {
  const parts = [];
  if (e.ctrlKey) parts.push('Ctrl');
  if (e.metaKey) parts.push('Cmd');
  if (e.altKey) parts.push('Alt');
  if (e.shiftKey) parts.push('Shift');
  parts.push(e.key.length === 1 ? e.key.toUpperCase() : e.key);
  return parts.join('+');
}

// Return { type, extra } ya null
export function classify(e) {
  const key = (e.key || '').toLowerCase();
  const mod = e.ctrlKey || e.metaKey;
  if (key === 'f12') return { type: T.DEVTOOLS_SHORTCUT };
  if (mod && e.shiftKey && ['i', 'j', 'c'].includes(key)) return { type: T.DEVTOOLS_SHORTCUT };
  if (e.metaKey && e.altKey && ['i', 'j', 'c'].includes(key)) return { type: T.DEVTOOLS_SHORTCUT };
  if (mod && !e.shiftKey && !e.altKey) {
    if (key === 'u') return { type: T.DEVTOOLS_SHORTCUT, extra: { key: 'view-source' } };
    if (key === 'p') return { type: T.PRINT_SHORTCUT };
    if (key === 'c') return { type: T.COPY_SHORTCUT, clip: true };
    if (key === 'v') return { type: T.PASTE_SHORTCUT, clip: true };
  }
  return null;
}

export function createShortcutMonitor(report, { block = true, allowInInputs = false, accessibilityMode = false } = {}) {
  const onKeyDown = (e) => {
    if (!e.key || MODIFIER_KEYS.has(e.key)) return;
    const hit = classify(e);
    if (!hit) return;
    const allowHere = accessibilityMode || !block || (hit.clip && allowInInputs && isEditableTarget(e.target));
    if (!allowHere) e.preventDefault();
    const meta = { combo: comboOf(e), ...(hit.extra || {}) };
    if (accessibilityMode) meta.accessibilityMode = true;
    report(hit.type, meta);
  };
  document.addEventListener('keydown', onKeyDown);
  return () => document.removeEventListener('keydown', onKeyDown);
}
