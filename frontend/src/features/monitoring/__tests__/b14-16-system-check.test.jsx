import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { runSystemCheck } from '../system-check/systemCheckService.js';
import { checkBrowser, checkStorage } from '../system-check/checkBrowser.js';
import { checkNetwork } from '../system-check/checkNetwork.js';
import { checkCamera, createPermissionMonitor } from '../system-check/checkCamera.js';
import { checkMicrophone } from '../system-check/checkMicrophone.js';
import { MemoryRouter } from 'react-router-dom';
import SystemCheckPage from '../../../pages/SystemCheckPage.jsx';

const okHealth = vi.fn().mockResolvedValue({ status: 'ok' });
const byId = (r, id) => r.checks.find((c) => c.id === id);
const setNav = (key, value) => Object.defineProperty(navigator, key, { value, configurable: true });
afterEach(() => { delete navigator.mediaDevices; delete navigator.permissions; });

function fakeStream() {
  const tracks = [{ stop: vi.fn() }, { stop: vi.fn() }];
  return { tracks, stream: { getTracks: () => tracks } };
}
const domErr = (name) => Object.assign(new Error(name), { name });

describe('B-14 system readiness check', () => {
  it('supported browser => PASS and overall passed', async () => {
    const r = await runSystemCheck({ policy: {}, healthFn: okHealth });
    expect(byId(r, 'browser').status).toBe('PASS');
    expect(byId(r, 'javascript').status).toBe('PASS');
    expect(r.passed).toBe(true);
    expect(r.checks.map((c) => c.id)).toEqual(expect.arrayContaining(['javascript', 'browser', 'storage', 'fullscreen', 'network', 'resolution', 'extensions']));
  });

  it('missing API => FAIL with readable message', () => {
    const win = { fetch: undefined, WebSocket: undefined, indexedDB: undefined, crypto: {} };
    const c = checkBrowser({ win, doc: document, ua: 'Chrome/120.0' });
    expect(c.status).toBe('FAIL');
    expect(c.message).toMatch(/fetch/);
    expect(c.message).toMatch(/IndexedDB/);
  });

  it('storage disabled => FAIL', async () => {
    const real = globalThis.indexedDB;
    Object.defineProperty(globalThis, 'indexedDB', { value: undefined, configurable: true });
    try {
      const c = await checkStorage();
      expect(c.status).toBe('FAIL');
      expect(c.message).toMatch(/private browsing|storage/i);
    } finally { Object.defineProperty(globalThis, 'indexedDB', { value: real, configurable: true }); }
  });

  it('slow network => WARN, still passed', async () => {
    let t = 0;
    const c = await checkNetwork({ healthFn: async () => {}, now: () => (t += 450) }); // each call 450ms apart => rtt 450? make slower below
    expect(c.status).toBe('PASS');
    let t2 = 0; const calls = [0, 900, 900, 1800, 1800, 2700]; // 3 rtts of 900ms
    const slow = await checkNetwork({ healthFn: async () => {}, now: () => calls[t2++] });
    expect(slow.status).toBe('WARN');
    expect(slow.message).toMatch(/slow/i);
  });

  it('network down => FAIL and overall not passed', async () => {
    const down = vi.fn().mockRejectedValue(new Error('offline'));
    expect((await checkNetwork({ healthFn: down })).status).toBe('FAIL');
    const r = await runSystemCheck({ policy: {}, healthFn: down });
    expect(r.passed).toBe(false);
  });

  it('makes exactly 3 health calls', async () => {
    const h = vi.fn().mockResolvedValue({});
    await checkNetwork({ healthFn: h });
    expect(h).toHaveBeenCalledTimes(3);
  });

  it('camera/mic permission matters only when policy requires them', async () => {
    const gum = vi.fn().mockRejectedValue(domErr('NotAllowedError'));
    setNav('mediaDevices', { getUserMedia: gum });
    const off = await runSystemCheck({ policy: { camera: false, microphone: false }, healthFn: okHealth });
    expect(byId(off, 'camera')).toBeUndefined();
    expect(gum).not.toHaveBeenCalled();
    expect(off.passed).toBe(true);
    const on = await runSystemCheck({ policy: { camera: true }, healthFn: okHealth });
    expect(byId(on, 'camera').status).toBe('FAIL');
    expect(on.passed).toBe(false);
  });

  it('every message is human readable (no raw error names)', async () => {
    const r = await runSystemCheck({ policy: {}, healthFn: okHealth });
    for (const c of r.checks) { expect(c.message.length).toBeGreaterThan(10); expect(c.message).not.toMatch(/Error|undefined|\[object/); }
  });

  it('small window => WARN (does not block)', async () => {
    const w = window.innerWidth; const h = window.innerHeight;
    Object.assign(window, { innerWidth: 800, innerHeight: 500 });
    try {
      const r = await runSystemCheck({ policy: {}, healthFn: okHealth });
      expect(byId(r, 'resolution').status).toBe('WARN');
      expect(r.passed).toBe(true);
    } finally { Object.assign(window, { innerWidth: w, innerHeight: h }); }
  });

  it('SystemCheckPage renders results; Continue disabled until passed (practice title too)', async () => {
    const onContinue = vi.fn();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ data: { status: 'ok' }, error: null }) }));
    try {
      render(<MemoryRouter><SystemCheckPage policy={{}} onContinue={onContinue} practice /></MemoryRouter>);
      expect(screen.getByRole('heading', { name: /practice system check/i })).toBeInTheDocument();
      await waitFor(() => expect(screen.getByText(/Your device is ready/)).toBeInTheDocument());
      fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
      expect(onContinue).toHaveBeenCalledOnce();
    } finally { vi.unstubAllGlobals(); }
  });
});

describe('B-15 camera check', () => {
  it('allowed => PASS and all tracks stopped immediately', async () => {
    const { tracks, stream } = fakeStream();
    const gum = vi.fn().mockResolvedValue(stream);
    setNav('mediaDevices', { getUserMedia: gum });
    expect((await checkCamera()).status).toBe('PASS');
    expect(gum).toHaveBeenCalledWith({ video: true });
    tracks.forEach((t) => expect(t.stop).toHaveBeenCalledOnce());
  });
  it('denied => FAIL permission denied', async () => {
    setNav('mediaDevices', { getUserMedia: vi.fn().mockRejectedValue(domErr('NotAllowedError')) });
    const r = await checkCamera();
    expect(r.status).toBe('FAIL'); expect(r.message).toMatch(/permission denied/i);
  });
  it('no device => FAIL', async () => {
    setNav('mediaDevices', { getUserMedia: vi.fn().mockRejectedValue(domErr('NotFoundError')) });
    expect((await checkCamera()).message).toMatch(/no camera/i);
  });
  it('other error => WARN; unsupported API => FAIL', async () => {
    setNav('mediaDevices', { getUserMedia: vi.fn().mockRejectedValue(domErr('NotReadableError')) });
    expect((await checkCamera()).status).toBe('WARN');
    setNav('mediaDevices', undefined);
    expect((await checkCamera()).status).toBe('FAIL');
  });
});

describe('B-16 microphone check', () => {
  it('allowed => PASS, tracks stopped, audio requested', async () => {
    const { tracks, stream } = fakeStream();
    const gum = vi.fn().mockResolvedValue(stream);
    setNav('mediaDevices', { getUserMedia: gum });
    expect((await checkMicrophone()).status).toBe('PASS');
    expect(gum).toHaveBeenCalledWith({ audio: true });
    tracks.forEach((t) => expect(t.stop).toHaveBeenCalled());
  });
  it('denied / no device / other', async () => {
    setNav('mediaDevices', { getUserMedia: vi.fn().mockRejectedValue(domErr('NotAllowedError')) });
    expect((await checkMicrophone()).status).toBe('FAIL');
    setNav('mediaDevices', { getUserMedia: vi.fn().mockRejectedValue(domErr('NotFoundError')) });
    expect((await checkMicrophone()).message).toMatch(/no microphone/i);
    setNav('mediaDevices', { getUserMedia: vi.fn().mockRejectedValue(domErr('AbortError')) });
    expect((await checkMicrophone()).status).toBe('WARN');
  });
});

describe('B-15/16 permission monitor', () => {
  const mockPermissions = () => {
    const statuses = {};
    const query = vi.fn(async ({ name }) => (statuses[name] = { state: 'granted', onchange: null }));
    setNav('permissions', { query });
    return { statuses, query };
  };

  it('reports camera + microphone permission changes', async () => {
    const { statuses } = mockPermissions();
    const report = vi.fn();
    createPermissionMonitor(report, { camera: true, microphone: true });
    await waitFor(() => expect(statuses.microphone?.onchange).toBeTypeOf('function'));
    statuses.camera.state = 'denied'; statuses.camera.onchange();
    statuses.microphone.state = 'prompt'; statuses.microphone.onchange();
    expect(report).toHaveBeenCalledWith('CAMERA_PERMISSION_CHANGED', { state: 'denied' });
    expect(report).toHaveBeenCalledWith('MICROPHONE_PERMISSION_CHANGED', { state: 'prompt' });
  });

  it('only watches what policy enables', async () => {
    const { query } = mockPermissions();
    createPermissionMonitor(vi.fn(), { camera: true });
    expect(query).toHaveBeenCalledTimes(1);
    expect(query).toHaveBeenCalledWith({ name: 'camera' });
  });

  it('cleanup detaches handlers', async () => {
    const { statuses } = mockPermissions();
    const report = vi.fn();
    const stop = createPermissionMonitor(report, { camera: true });
    await waitFor(() => expect(statuses.camera.onchange).toBeTypeOf('function'));
    stop();
    expect(statuses.camera.onchange).toBeNull();
  });

  it('unsupported permissions API / unsupported name is graceful', async () => {
    expect(() => createPermissionMonitor(vi.fn(), { camera: true })()).not.toThrow(); // no navigator.permissions
    setNav('permissions', { query: vi.fn().mockRejectedValue(new TypeError('unsupported')) });
    const stop = createPermissionMonitor(vi.fn(), { camera: true, microphone: true });
    await Promise.resolve();
    expect(() => stop()).not.toThrow();
  });
});
