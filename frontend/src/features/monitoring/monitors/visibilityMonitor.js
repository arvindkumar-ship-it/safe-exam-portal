import { EVENT_TYPES as T } from '../events/eventTypes.js';

// Tab switch / minimize detect (Page Visibility API). Same state dobara report nahi.
export function createVisibilityMonitor(report) {
  const current = () => (document.visibilityState === 'hidden' ? 'hidden' : 'visible');
  let last = current();
  const onChange = () => {
    const state = current();
    if (state === last) return;
    last = state;
    if (state === 'hidden') report(T.PAGE_HIDDEN, { visibilityState: 'hidden' });
    else report(T.PAGE_VISIBLE, {});
  };
  document.addEventListener('visibilitychange', onChange);
  return () => document.removeEventListener('visibilitychange', onChange);
}
