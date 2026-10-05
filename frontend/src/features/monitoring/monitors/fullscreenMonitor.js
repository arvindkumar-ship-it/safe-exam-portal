import { EVENT_TYPES as T } from '../events/eventTypes.js';

let active = null; // { report, unavailableReported } — requestFullscreen isse report karta hai

export const isFullscreenSupported = () =>
  typeof document !== 'undefined' && !!(document.documentElement.requestFullscreen);

function reportUnavailable(reason, report) {
  const r = report || (active && active.report);
  if (!r) return;
  if (active && report === undefined) {
    if (active.unavailableReported) return;
    active.unavailableReported = true;
  }
  r(T.FULLSCREEN_UNAVAILABLE, { reason });
}

// User click (gesture) se chalana zaroori hai. Reject/unsupported => FULLSCREEN_UNAVAILABLE + false.
export async function requestFullscreen(el = document.documentElement, report) {
  if (!el || typeof el.requestFullscreen !== 'function') {
    reportUnavailable('unsupported', report);
    return false;
  }
  try {
    await el.requestFullscreen();
    return true;
  } catch {
    reportUnavailable('rejected', report);
    return false;
  }
}

export function createFullscreenMonitor(report, { onChange } = {}) {
  const state = { report, unavailableReported: false };
  active = state;
  let inFs = !!document.fullscreenElement;
  if (onChange) onChange(inFs);
  if (!isFullscreenSupported()) reportUnavailable('unsupported'); // degrade: exam chalta rahega

  const handler = () => {
    const now = !!document.fullscreenElement;
    if (now === inFs) return; // ek transition = ek event
    inFs = now;
    if (onChange) onChange(now);
    report(now ? T.FULLSCREEN_ENTERED : T.FULLSCREEN_EXIT, {});
  };
  document.addEventListener('fullscreenchange', handler);
  return () => {
    document.removeEventListener('fullscreenchange', handler);
    if (active === state) active = null;
  };
}
