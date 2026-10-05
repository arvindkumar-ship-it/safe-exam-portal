import { EVENT_TYPES as T } from '../events/eventTypes.js';
import { isEditableTarget } from './domUtils.js';

// Right-click. accessibilityMode ya (allowInInputs + input) => allow, par report hota hai.
export function createContextMenuMonitor(report, { allowInInputs = false, accessibilityMode = false } = {}) {
  const handler = (e) => {
    const allow = accessibilityMode || (allowInInputs && isEditableTarget(e.target));
    if (!allow) e.preventDefault();
    const meta = { blocked: !allow };
    if (accessibilityMode) meta.accessibilityMode = true;
    report(T.CONTEXT_MENU_ATTEMPT, meta);
  };
  document.addEventListener('contextmenu', handler);
  return () => document.removeEventListener('contextmenu', handler);
}
