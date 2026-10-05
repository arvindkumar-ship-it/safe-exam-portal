import { vi } from 'vitest';

// Net active listeners per event type track karta hai (duplicate/cleanup tests ke liye).
export function trackListeners(...targets) {
  const active = new Map();
  let id = 0;
  const tag = (fn) => { if (fn && !fn.__id) fn.__id = ++id; };
  const keyOf = (t, type, fn) => `${targets.indexOf(t)}|${type}|${fn && fn.__id}`;
  for (const t of targets) {
    t.addEventListener.mockRestore?.(); t.removeEventListener.mockRestore?.();
    // pehle ke spies hatao, warna bind purane mock par chain hoke infinite recursion hota hai
    t.addEventListener.mockRestore?.();
    t.removeEventListener.mockRestore?.();
    const add = t.addEventListener.bind(t);
    const rem = t.removeEventListener.bind(t);
    vi.spyOn(t, 'addEventListener').mockImplementation((type, fn, o) => { tag(fn); active.set(keyOf(t, type, fn), type); return add(type, fn, o); });
    vi.spyOn(t, 'removeEventListener').mockImplementation((type, fn, o) => { tag(fn); active.delete(keyOf(t, type, fn)); return rem(type, fn, o); });
  }
  return {
    count: (type) => [...active.values()].filter((x) => x === type).length,
    total: () => active.size,
  };
}

export function setVisibility(state) {
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => state });
  document.dispatchEvent(new Event('visibilitychange'));
}
