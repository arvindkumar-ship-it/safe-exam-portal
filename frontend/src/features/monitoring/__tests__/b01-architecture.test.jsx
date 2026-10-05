import { StrictMode } from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { vi } from 'vitest';
import { MonitoringProvider } from '../MonitoringProvider.jsx';
import { useExamMonitoring } from '../useExamMonitoring.js';
import { resolvePolicy, DEFAULT_POLICY } from '../policy.js';
import { EVENT_TYPES, isWebEventType } from '../events/eventTypes.js';
import { createEventFactory } from '../events/eventFactory.js';
import { createMemoryStore } from '../events/indexedDbEventStore.js';
import { isNativeClient, bindNativeClient, onNativeEvent, requestNativeExit } from '../nativeBridgeAdapter.js';
import { trackListeners, setVisibility } from '../../../test/listeners.js';

const OFF = { visibility: false, focus: false, fullscreen: false, clipboard: false, shortcuts: false, contextMenu: false, selection: false, network: false, heartbeat: false };
const mkDeps = () => ({ store: createMemoryStore(), sendEvents: vi.fn().mockRejectedValue(new Error('net')) });
const tick = (ms = 60) => new Promise((r) => setTimeout(r, ms));
function Probe() {
  const m = useExamMonitoring();
  return <div data-testid="s">{JSON.stringify({ ...m.status, reason: m.reason })}</div>;
}
afterEach(() => { delete document.visibilityState; });

describe('B-01 provider', () => {
  it('monitoring starts once (StrictMode) and cleanup removes listeners', async () => {
    const l = trackListeners(document, window);
    const deps = mkDeps();
    const { unmount } = render(
      <StrictMode>
        <MonitoringProvider attemptId="a1" policy={{ ...OFF, visibility: true, focus: true }} consentGiven deps={deps}><Probe /></MonitoringProvider>
      </StrictMode>,
    );
    await waitFor(() => expect(l.count('visibilitychange')).toBe(1));
    await tick();
    expect(l.count('visibilitychange')).toBe(1);
    expect(l.count('blur')).toBe(1);
    unmount();
    expect(l.count('visibilitychange')).toBe(0);
    expect(l.count('blur')).toBe(0);
  });

  it('two providers on same attempt => no duplicate listeners/events', async () => {
    const l = trackListeners(document);
    const deps = mkDeps();
    render(
      <>
        <MonitoringProvider attemptId="dup" policy={{ ...OFF, visibility: true }} consentGiven deps={deps}><span /></MonitoringProvider>
        <MonitoringProvider attemptId="dup" policy={{ ...OFF, visibility: true }} consentGiven deps={deps}><span /></MonitoringProvider>
      </>,
    );
    await tick();
    expect(l.count('visibilitychange')).toBe(1);
    setVisibility('hidden');
    await waitFor(async () => expect((await deps.store.all()).length).toBe(1));
  });

  it('reports events into the queue', async () => {
    const deps = mkDeps();
    render(<MonitoringProvider attemptId="a2" policy={{ ...OFF, visibility: true }} consentGiven deps={deps}><Probe /></MonitoringProvider>);
    await tick();
    setVisibility('hidden');
    await waitFor(async () => {
      const all = await deps.store.all();
      expect(all[0]).toMatchObject({ eventType: 'PAGE_HIDDEN', source: 'WEB_CLIENT', clientSequence: 1 });
    });
  });

  it('policy flags off => no events', async () => {
    const deps = mkDeps();
    render(<MonitoringProvider attemptId="a3" policy={OFF} consentGiven deps={deps}><Probe /></MonitoringProvider>);
    await tick();
    setVisibility('hidden');
    window.dispatchEvent(new Event('blur'));
    document.dispatchEvent(new Event('copy', { bubbles: true }));
    window.dispatchEvent(new Event('offline'));
    await tick();
    expect(await deps.store.all()).toHaveLength(0);
  });

  it('consent missing => blocked, nothing starts', async () => {
    const l = trackListeners(document);
    const deps = mkDeps();
    render(<MonitoringProvider attemptId="a4" policy={{ ...OFF, visibility: true }} consentGiven={false} deps={deps}><Probe /></MonitoringProvider>);
    await tick();
    expect(l.count('visibilitychange')).toBe(0);
    expect(JSON.parse(screen.getByTestId('s').textContent)).toMatchObject({ blocked: true, reason: 'CONSENT_REQUIRED' });
    setVisibility('hidden');
    await tick();
    expect(await deps.store.all()).toHaveLength(0);
  });

  it('accessibilityMode => events flagged in metadata', async () => {
    const deps = mkDeps();
    render(<MonitoringProvider attemptId="a5" policy={{ ...OFF, clipboard: true, accessibilityMode: true }} consentGiven deps={deps}><Probe /></MonitoringProvider>);
    await tick();
    const ev = new Event('copy', { bubbles: true, cancelable: true });
    document.body.dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(false);
    await waitFor(async () => expect((await deps.store.all())[0].metadata).toMatchObject({ action: 'copy', accessibilityMode: true }));
  });

  it('event sequence persists across remount (restart)', async () => {
    const deps = mkDeps();
    const policy = { ...OFF, visibility: true };
    const first = render(<MonitoringProvider attemptId="a6" policy={policy} consentGiven deps={deps}><Probe /></MonitoringProvider>);
    await tick();
    setVisibility('hidden'); setVisibility('visible');
    await waitFor(async () => expect((await deps.store.all()).length).toBe(2));
    first.unmount();
    render(<MonitoringProvider attemptId="a6" policy={policy} consentGiven deps={deps}><Probe /></MonitoringProvider>);
    await tick();
    setVisibility('hidden');
    await waitFor(async () => expect((await deps.store.all()).map((e) => e.clientSequence)).toEqual([1, 2, 3]));
  });
});

describe('B-01 policy + types + factory + native', () => {
  it('resolvePolicy deep-merges, ignores unknown keys', () => {
    const p = resolvePolicy({ fullscreen: false, clipboard: { allowInInputs: true }, bogus: 1, selection: false });
    expect(p.fullscreen).toBe(false);
    expect(p.clipboard).toEqual({ block: true, allowInInputs: true });
    expect(p.selection).toBe(false);
    expect(p.bogus).toBeUndefined();
    expect(resolvePolicy()).toEqual(DEFAULT_POLICY);
  });

  it('event types frozen + web-only', () => {
    expect(Object.isFrozen(EVENT_TYPES)).toBe(true);
    expect(EVENT_TYPES.PAGE_HIDDEN).toBe('PAGE_HIDDEN');
    expect(isWebEventType('FULLSCREEN_EXIT')).toBe(true);
    expect(isWebEventType('UNAUTHORIZED_PROCESS')).toBe(false);
  });

  it('factory: sequence increments, unknown throws, ISO timestamp, sanitize', () => {
    const now = () => new Date('2026-10-04T18:40:00.000Z');
    const f = createEventFactory({ attemptId: 'a', now });
    const e1 = f.create('FULLSCREEN_EXIT');
    const e2 = f.create('PAGE_HIDDEN', { visibilityState: 'hidden' });
    expect([e1.clientSequence, e2.clientSequence]).toEqual([1, 2]);
    expect(e1).toEqual({ eventType: 'FULLSCREEN_EXIT', source: 'WEB_CLIENT', occurredAt: '2026-10-04T18:40:00.000Z', clientSequence: 1, metadata: {} });
    expect(f.peekSequence()).toBe(3);
    expect(() => f.create('STUDENT_CHEATED')).toThrow();
    const big = Object.fromEntries(Array.from({ length: 30 }, (_, i) => [`k${i}`, 'x'.repeat(500)]));
    const m = f.create('WINDOW_BLUR', { ...big, fn: () => 1, node: document.body, text: 'clipboard secret', long: 'y'.repeat(999) }).metadata;
    expect(Object.keys(m).length).toBeLessThanOrEqual(20);
    expect(m.fn).toBeUndefined(); expect(m.node).toBeUndefined(); expect(m.text).toBeUndefined();
    expect(new TextEncoder().encode(JSON.stringify(m)).length).toBeLessThanOrEqual(2048);
  });

  it('native adapter: no-ops in browser, works with webview mock', async () => {
    expect(isNativeClient()).toBe(false);
    expect(await bindNativeClient({ attemptId: 'a', accessToken: 't' })).toBeNull();
    expect(typeof onNativeEvent(() => {})).toBe('function');
    expect(await requestNativeExit('X')).toEqual({ ok: false });

    const ls = new Set();
    window.chrome = { webview: {
      postMessage: (msg) => setTimeout(() => ls.forEach((l) => l({ data: { id: msg.id, ok: true, data: { bound: msg.command } } })), 0),
      addEventListener: (t, fn) => ls.add(fn), removeEventListener: (t, fn) => ls.delete(fn),
    } };
    try {
      expect(isNativeClient()).toBe(true);
      expect(await bindNativeClient({ attemptId: 'a', accessToken: 't' })).toEqual({ bound: 'getSessionStatus' });
      const cb = vi.fn();
      const off = onNativeEvent(cb);
      ls.forEach((l) => l({ data: { command: 'reportNativeEvent', payload: { eventType: 'X' } } }));
      expect(cb).toHaveBeenCalledWith({ eventType: 'X' });
      off();
      expect(ls.size).toBe(0);
    } finally { delete window.chrome; }
  });
});
