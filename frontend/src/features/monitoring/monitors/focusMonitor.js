import { EVENT_TYPES as T } from '../events/eventTypes.js';

// Window blur/focus. Hidden page par blur skip (B-02 cover karta hai). Kabhi terminate nahi.
export function createFocusMonitor(report, { minGapMs = 2000 } = {}) {
  let lastBlurAt = -Infinity;
  let blurred = false;
  const onBlur = () => {
    if (document.visibilityState === 'hidden') return;
    const now = Date.now();
    if (now - lastBlurAt < minGapMs) return; // rapid blur debounce
    lastBlurAt = now;
    blurred = true;
    report(T.WINDOW_BLUR, {});
  };
  const onFocus = () => {
    if (!blurred) return;
    blurred = false;
    report(T.WINDOW_FOCUS, {});
  };
  window.addEventListener('blur', onBlur);
  window.addEventListener('focus', onFocus);
  return () => {
    window.removeEventListener('blur', onBlur);
    window.removeEventListener('focus', onFocus);
  };
}
