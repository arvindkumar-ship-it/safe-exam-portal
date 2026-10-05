import { EVENT_TYPES as T } from '../events/eventTypes.js';
import { isEditableTarget } from './domUtils.js';

// copy/cut/paste detect. Clipboard ka content kabhi read/log nahi hota.
export function createClipboardMonitor(report, { block = true, allowInInputs = false, accessibilityMode = false } = {}) {
  const handler = (e) => {
    const inInput = isEditableTarget(e.target);
    const allow = accessibilityMode || !block || (inInput && allowInInputs);
    if (!allow) e.preventDefault();
    const meta = { action: e.type, blocked: !allow };
    if (accessibilityMode) meta.accessibilityMode = true;
    report(T.CLIPBOARD_ATTEMPT, meta);
  };
  const types = ['copy', 'cut', 'paste'];
  types.forEach((t) => document.addEventListener(t, handler));
  return () => types.forEach((t) => document.removeEventListener(t, handler));
}
