export const DEFAULT_POLICY = {
  requireConsent: true, fullscreen: true, visibility: true, focus: true,
  clipboard: { block: true, allowInInputs: false }, shortcuts: true, contextMenu: true,
  selection: { block: true }, network: true, heartbeat: true, camera: false, microphone: false,
  accessibilityMode: false,
  offlineGraceSeconds: 300, // B-23 (extra key)
};

// Student-facing messages (exact text).
export const MESSAGES = {
  banner: 'Exam monitoring is active. Focus changes and fullscreen exits may be recorded for review.',
  blur: 'Your exam window lost focus. This event has been recorded for review.',
  hidden: 'Your exam page was hidden. This event has been recorded for review.',
  fullscreenExit: 'You left fullscreen. This event has been recorded for review.',
  clipboard: 'A copy or paste attempt was detected. This event has been recorded for review.',
  generic: 'A monitoring event was recorded for review.',
};

// Sirf inhi events par student ko warning dikhti hai.
export const WARNING_BY_EVENT = {
  WINDOW_BLUR: MESSAGES.blur,
  PAGE_HIDDEN: MESSAGES.hidden,
  FULLSCREEN_EXIT: MESSAGES.fullscreenExit,
  CLIPBOARD_ATTEMPT: MESSAGES.clipboard,
};

const isPlain = (v) => v && typeof v === 'object' && !Array.isArray(v);

// Server policy ko DEFAULT_POLICY par deep-merge. Unknown keys ignore, type mismatch ignore.
// Object-type flags (clipboard, selection) par `false` = poora band, `true` = default.
export function resolvePolicy(serverPolicy = {}) {
  const src = isPlain(serverPolicy) ? serverPolicy : {};
  const out = {};
  for (const [key, def] of Object.entries(DEFAULT_POLICY)) {
    const val = src[key];
    if (isPlain(def)) {
      if (val === false) out[key] = false;
      else if (isPlain(val)) {
        out[key] = { ...def };
        for (const k of Object.keys(def)) if (typeof val[k] === typeof def[k]) out[key][k] = val[k];
      } else out[key] = { ...def };
    } else {
      out[key] = typeof val === typeof def && !(typeof val === 'number' && !Number.isFinite(val)) ? val : def;
    }
  }
  return out;
}
