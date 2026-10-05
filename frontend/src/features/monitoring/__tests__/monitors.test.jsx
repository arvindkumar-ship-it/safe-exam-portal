import { render, screen, fireEvent } from '@testing-library/react';
import { vi } from 'vitest';
import { createVisibilityMonitor } from '../monitors/visibilityMonitor.js';
import { createFocusMonitor } from '../monitors/focusMonitor.js';
import { createFullscreenMonitor, requestFullscreen } from '../monitors/fullscreenMonitor.js';
import { createClipboardMonitor } from '../monitors/clipboardMonitor.js';
import { createShortcutMonitor } from '../monitors/shortcutMonitor.js';
import { createContextMenuMonitor } from '../monitors/contextMenuMonitor.js';
import { createSelectionMonitor } from '../monitors/selectionMonitor.js';
import { createNetworkMonitor } from '../monitors/networkMonitor.js';
import { createHeartbeatMonitor } from '../monitors/heartbeatMonitor.js';
import FullscreenBanner from '../FullscreenBanner.jsx';
import { MonitoringProvider } from '../MonitoringProvider.jsx';
import { createMemoryStore } from '../events/indexedDbEventStore.js';
import { trackListeners, setVisibility } from '../../../test/listeners.js';

// Har test ke baad bache hue listeners hata do (isolation).
const registry = [];
beforeEach(() => {
  for (const t of [document, window]) {
    const add = t.addEventListener.bind(t);
    vi.spyOn(t, 'addEventListener').mockImplementation((ty, fn, o) => { registry.push([t, ty, fn, o]); return add(ty, fn, o); });
  }
});
afterEach(() => { registry.splice(0).forEach(([t, ty, fn, o]) => t.removeEventListener(ty, fn, o)); });

const key = (init) => new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init });
afterEach(() => {
  delete document.visibilityState;
  delete document.fullscreenElement;
  delete document.documentElement.requestFullscreen;
  document.body.innerHTML = '';
});

describe('B-02 visibility', () => {
  it('hidden/visible events, no duplicate, cleanup', () => {
    const l = trackListeners(document);
    const report = vi.fn();
    const stop = createVisibilityMonitor(report);
    setVisibility('hidden'); setVisibility('hidden');
    expect(report.mock.calls).toEqual([['PAGE_HIDDEN', { visibilityState: 'hidden' }]]);
    setVisibility('visible');
    expect(report).toHaveBeenLastCalledWith('PAGE_VISIBLE', {});
    expect(report).toHaveBeenCalledTimes(2);
    stop();
    expect(l.count('visibilitychange')).toBe(0);
  });
});

describe('B-03 focus', () => {
  beforeEach(() => vi.useFakeTimers());
  it('blur, focus restore, rapid debounce, cleanup', () => {
    const l = trackListeners(window);
    const report = vi.fn();
    const stop = createFocusMonitor(report, { minGapMs: 2000 });
    window.dispatchEvent(new Event('blur'));
    window.dispatchEvent(new Event('blur'));
    expect(report).toHaveBeenCalledTimes(1);
    window.dispatchEvent(new Event('focus'));
    expect(report).toHaveBeenLastCalledWith('WINDOW_FOCUS', {});
    vi.advanceTimersByTime(2500);
    window.dispatchEvent(new Event('blur'));
    expect(report).toHaveBeenCalledTimes(3);
    stop();
    expect(l.count('blur')).toBe(0);
  });
  it('blur on hidden page skipped', () => {
    const report = vi.fn();
    createFocusMonitor(report);
    setVisibility('hidden');
    window.dispatchEvent(new Event('blur'));
    window.dispatchEvent(new Event('focus'));
    expect(report).not.toHaveBeenCalled();
  });
});

describe('B-04 fullscreen', () => {
  const setFs = (el) => { Object.defineProperty(document, 'fullscreenElement', { configurable: true, get: () => el }); document.dispatchEvent(new Event('fullscreenchange')); };
  it('supported: enter, Escape exit once, cleanup', async () => {
    const l = trackListeners(document);
    document.documentElement.requestFullscreen = vi.fn().mockResolvedValue();
    const report = vi.fn();
    const stop = createFullscreenMonitor(report);
    expect(await requestFullscreen()).toBe(true);
    setFs(document.documentElement);
    setFs(null); setFs(null);
    expect(report.mock.calls.map((c) => c[0])).toEqual(['FULLSCREEN_ENTERED', 'FULLSCREEN_EXIT']);
    stop();
    expect(l.count('fullscreenchange')).toBe(0);
  });
  it('unsupported => FULLSCREEN_UNAVAILABLE once + false', async () => {
    const report = vi.fn();
    createFullscreenMonitor(report);
    expect(await requestFullscreen()).toBe(false);
    expect(report.mock.calls.map((c) => c[0])).toEqual(['FULLSCREEN_UNAVAILABLE']);
  });
  it('user rejects => false + UNAVAILABLE', async () => {
    document.documentElement.requestFullscreen = vi.fn().mockRejectedValue(new Error('denied'));
    const report = vi.fn();
    createFullscreenMonitor(report);
    expect(await requestFullscreen()).toBe(false);
    expect(report).toHaveBeenCalledWith('FULLSCREEN_UNAVAILABLE', { reason: 'rejected' });
  });
  it('banner re-enter button works', () => {
    const rf = vi.fn().mockResolvedValue();
    document.documentElement.requestFullscreen = rf;
    render(<MonitoringProvider attemptId="fs" policy={{ visibility: false, focus: false, clipboard: false, shortcuts: false, contextMenu: false, selection: false, network: false, heartbeat: false }} consentGiven deps={{ store: createMemoryStore() }}><FullscreenBanner /></MonitoringProvider>);
    fireEvent.click(screen.getByRole('button', { name: 'Re-enter fullscreen' }));
    expect(rf).toHaveBeenCalled();
  });
});

describe('B-05 clipboard', () => {
  const fire = (type, target = document.body) => { const e = new Event(type, { bubbles: true, cancelable: true }); target.dispatchEvent(e); return e; };
  it('copy/paste blocked + logged, no content', () => {
    const l = trackListeners(document);
    const report = vi.fn();
    const stop = createClipboardMonitor(report);
    expect(fire('copy').defaultPrevented).toBe(true);
    expect(fire('paste').defaultPrevented).toBe(true);
    expect(report.mock.calls).toEqual([['CLIPBOARD_ATTEMPT', { action: 'copy', blocked: true }], ['CLIPBOARD_ATTEMPT', { action: 'paste', blocked: true }]]);
    stop();
    expect(l.count('copy') + l.count('cut') + l.count('paste')).toBe(0);
  });
  it('allowInInputs respected (still reported)', () => {
    const report = vi.fn();
    createClipboardMonitor(report, { allowInInputs: true });
    const input = document.body.appendChild(document.createElement('input'));
    expect(fire('paste', input).defaultPrevented).toBe(false);
    expect(report).toHaveBeenCalledWith('CLIPBOARD_ATTEMPT', { action: 'paste', blocked: false });
    expect(fire('paste').defaultPrevented).toBe(true);
  });
  it('accessibility override', () => {
    const report = vi.fn();
    createClipboardMonitor(report, { accessibilityMode: true });
    expect(fire('cut').defaultPrevented).toBe(false);
    expect(report.mock.calls[0][1]).toMatchObject({ action: 'cut', accessibilityMode: true });
  });
});

describe('B-06 shortcuts', () => {
  const cases = [
    [{ key: 'c', ctrlKey: true }, 'COPY_SHORTCUT', 'Ctrl+C'],
    [{ key: 'v', metaKey: true }, 'PASTE_SHORTCUT', 'Cmd+V'],
    [{ key: 'F12' }, 'DEVTOOLS_SHORTCUT', 'F12'],
    [{ key: 'I', ctrlKey: true, shiftKey: true }, 'DEVTOOLS_SHORTCUT', 'Ctrl+Shift+I'],
    [{ key: 'J', ctrlKey: true, shiftKey: true }, 'DEVTOOLS_SHORTCUT', 'Ctrl+Shift+J'],
    [{ key: 'C', ctrlKey: true, shiftKey: true }, 'DEVTOOLS_SHORTCUT', 'Ctrl+Shift+C'],
    [{ key: 'i', metaKey: true, altKey: true }, 'DEVTOOLS_SHORTCUT', 'Cmd+Alt+I'],
    [{ key: 'p', ctrlKey: true }, 'PRINT_SHORTCUT', 'Ctrl+P'],
    [{ key: 'u', ctrlKey: true }, 'DEVTOOLS_SHORTCUT', 'Ctrl+U'],
  ];
  it.each(cases)('%j => %s', (init, type, combo) => {
    const report = vi.fn();
    createShortcutMonitor(report);
    const e = key(init);
    document.dispatchEvent(e);
    expect(e.defaultPrevented).toBe(true);
    expect(report).toHaveBeenCalledWith(type, expect.objectContaining({ combo }));
  });
  it('view-source flag, normal typing + modifier-only ignored, cleanup', () => {
    const l = trackListeners(document);
    const report = vi.fn();
    const stop = createShortcutMonitor(report);
    document.dispatchEvent(key({ key: 'u', ctrlKey: true }));
    expect(report.mock.calls[0][1]).toMatchObject({ key: 'view-source' });
    report.mockClear();
    document.dispatchEvent(key({ key: 'a' }));
    document.dispatchEvent(key({ key: 'Control', ctrlKey: true }));
    document.dispatchEvent(key({ key: 'Shift', shiftKey: true }));
    expect(report).not.toHaveBeenCalled();
    stop();
    expect(l.count('keydown')).toBe(0);
  });
  it('accessibilityMode => no preventDefault, flagged', () => {
    const report = vi.fn();
    createShortcutMonitor(report, { accessibilityMode: true });
    const e = key({ key: 'F12' });
    document.dispatchEvent(e);
    expect(e.defaultPrevented).toBe(false);
    expect(report.mock.calls[0][1].accessibilityMode).toBe(true);
  });
});

describe('B-07 context menu', () => {
  it('right-click event, input policy, cleanup', () => {
    const l = trackListeners(document);
    const report = vi.fn();
    const stop = createContextMenuMonitor(report, { allowInInputs: true });
    const e = new Event('contextmenu', { bubbles: true, cancelable: true });
    document.body.dispatchEvent(e);
    expect(e.defaultPrevented).toBe(true);
    expect(report).toHaveBeenCalledWith('CONTEXT_MENU_ATTEMPT', { blocked: true });
    const input = document.body.appendChild(document.createElement('input'));
    const e2 = new Event('contextmenu', { bubbles: true, cancelable: true });
    input.dispatchEvent(e2);
    expect(e2.defaultPrevented).toBe(false);
    stop();
    expect(l.count('contextmenu')).toBe(0);
  });
});

describe('B-08 selection', () => {
  const setup = () => {
    document.body.innerHTML = '<div data-exam-content><p id="p">text</p><textarea id="t"></textarea></div><p id="out">x</p>';
    return (id, type) => { const e = new Event(type, { bubbles: true, cancelable: true }); document.getElementById(id).dispatchEvent(e); return e.defaultPrevented; };
  };
  it('blocked in content, inputs/outside unaffected, drag blocked, cleanup', () => {
    const fire = setup();
    const stop = createSelectionMonitor({});
    expect(document.querySelector('[data-exam-content]')).toHaveClass('exam-no-select');
    expect(fire('p', 'selectstart')).toBe(true);
    expect(fire('p', 'dragstart')).toBe(true);
    expect(fire('t', 'selectstart')).toBe(false);
    expect(fire('out', 'selectstart')).toBe(false);
    stop();
    expect(fire('p', 'selectstart')).toBe(false);
    expect(document.querySelector('[data-exam-content]')).not.toHaveClass('exam-no-select');
  });
  it('accessibilityMode allows everything', () => {
    const fire = setup();
    createSelectionMonitor({ accessibilityMode: true });
    expect(fire('p', 'selectstart')).toBe(false);
    expect(document.querySelector('[data-exam-content]')).not.toHaveClass('exam-no-select');
  });
});

describe('B-09 network', () => {
  it('disconnect/reconnect events, status updates, cleanup', () => {
    const l = trackListeners(window);
    const report = vi.fn(); const onChange = vi.fn();
    const stop = createNetworkMonitor(report, { onChange });
    window.dispatchEvent(new Event('offline'));
    window.dispatchEvent(new Event('online'));
    expect(report.mock.calls.map((c) => c[0])).toEqual(['NETWORK_DISCONNECTED', 'NETWORK_RECONNECTED']);
    expect(onChange.mock.calls.map((c) => c[0])).toEqual([true, false, true]);
    stop();
    expect(l.count('offline') + l.count('online')).toBe(0);
  });
});

describe('B-10 heartbeat', () => {
  beforeEach(() => vi.useFakeTimers());
  const ok = { serverTime: '2026-10-04T10:00:00Z', expiresAt: '2026-10-04T11:00:00Z', attemptStatus: 'IN_PROGRESS' };
  const mk = (fn, extra = {}) => { const report = vi.fn(); const stop = createHeartbeatMonitor(report, { attemptId: 'a', heartbeatFn: fn, random: () => 0.5, ...extra }); return { report, stop }; };

  it('calls on interval + server time callback', async () => {
    const fn = vi.fn().mockResolvedValue(ok); const onServerTime = vi.fn();
    mk(fn, { onServerTime });
    await vi.advanceTimersByTimeAsync(15000);
    await vi.advanceTimersByTimeAsync(15000);
    expect(fn).toHaveBeenCalledTimes(2);
    expect(onServerTime).toHaveBeenCalledWith(ok.serverTime, ok.expiresAt);
  });
  it('2 failures => one HEARTBEAT_MISSED, no repeat, recovery resets', async () => {
    const fn = vi.fn().mockRejectedValue(new Error('x'));
    const { report } = mk(fn);
    await vi.advanceTimersByTimeAsync(15000);
    expect(report).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(30000);
    expect(report).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(30000);
    expect(report).toHaveBeenCalledTimes(1); // same outage
    fn.mockResolvedValueOnce(ok);
    await vi.advanceTimersByTimeAsync(30000);
    fn.mockRejectedValue(new Error('x'));
    await vi.advanceTimersByTimeAsync(15000);
    await vi.advanceTimersByTimeAsync(30000);
    expect(report).toHaveBeenCalledTimes(2); // new outage
  });
  it('terminal status callback, then stops', async () => {
    const fn = vi.fn().mockResolvedValue({ ...ok, attemptStatus: 'AUTO_SUBMITTED' }); const onAttemptStatus = vi.fn();
    mk(fn, { onAttemptStatus });
    await vi.advanceTimersByTimeAsync(60000);
    expect(onAttemptStatus).toHaveBeenCalledWith('AUTO_SUBMITTED');
    expect(fn).toHaveBeenCalledTimes(1);
  });
  it('cleanup clears timers', () => {
    const { stop } = mk(vi.fn().mockResolvedValue(ok));
    expect(vi.getTimerCount()).toBe(1);
    stop();
    expect(vi.getTimerCount()).toBe(0);
  });
});
