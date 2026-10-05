import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { getBrowserSupport } from '../../../utils/browserSupport.js';
import { checkBrowser } from '../system-check/checkBrowser.js';
import { createFullscreenMonitor } from '../monitors/fullscreenMonitor.js';
import UnsupportedBrowserPage from '../../../pages/UnsupportedBrowserPage.jsx';
import App from '../../../App.jsx';
import { renderAt } from '../../../testUtils.jsx';

const MODERN_WIN = { fetch: () => {}, WebSocket: function WS() {}, indexedDB: {}, crypto: { subtle: {} } };
const FS_DOC = { documentElement: { requestFullscreen: () => {} } };
const CHROME_UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';
afterEach(() => { vi.restoreAllMocks(); window.history.pushState({}, '', '/'); });

describe('B-22 browser support', () => {
  it('modern browser => supported, nothing missing, UA shown for display', () => {
    const r = getBrowserSupport({ win: MODERN_WIN, doc: FS_DOC, ua: CHROME_UA });
    expect(r).toEqual({ supported: true, missing: [], browser: { name: 'Chrome', version: '126.0.0.0' } });
  });

  it('detects the common browsers from the UA (display only)', () => {
    const name = (ua) => getBrowserSupport({ win: MODERN_WIN, doc: FS_DOC, ua }).browser.name;
    expect(name('Mozilla/5.0 Firefox/127.0')).toBe('Firefox');
    expect(name(`${CHROME_UA} Edg/126.0.2592.81`)).toBe('Edge');
    expect(name('Mozilla/5.0 (Macintosh) AppleWebKit/605.1.15 Version/17.5 Safari/605.1.15')).toBe('Safari');
  });

  it('missing feature is listed; each required API is detected', () => {
    for (const [key, label] of [['fetch', 'fetch'], ['WebSocket', 'WebSocket'], ['indexedDB', 'IndexedDB']]) {
      const r = getBrowserSupport({ win: { ...MODERN_WIN, [key]: undefined }, doc: FS_DOC, ua: CHROME_UA });
      expect(r.supported).toBe(false);
      expect(r.missing).toContain(label);
    }
    const noCrypto = getBrowserSupport({ win: { ...MODERN_WIN, crypto: {} }, doc: FS_DOC, ua: CHROME_UA });
    expect(noCrypto.missing).toContain('crypto.subtle');
  });

  it('feature detection wins over UA: a "Chrome" UA with missing APIs is unsupported', () => {
    expect(getBrowserSupport({ win: {}, doc: FS_DOC, ua: CHROME_UA }).supported).toBe(false);
  });

  it('unknown / empty UA is graceful (feature detection still decides)', () => {
    const r = getBrowserSupport({ win: MODERN_WIN, doc: FS_DOC, ua: '' });
    expect(r.supported).toBe(true);
    expect(r.browser).toEqual({ name: 'Unknown', version: '' });
    expect(() => getBrowserSupport({ win: MODERN_WIN, doc: FS_DOC, ua: undefined })).not.toThrow();
  });

  it('Fullscreen API missing => degrade, not unsupported', () => {
    const r = getBrowserSupport({ win: MODERN_WIN, doc: { documentElement: {} }, ua: CHROME_UA });
    expect(r.supported).toBe(true);
    expect(r.missing).toEqual(['Fullscreen API']);
    expect(checkBrowser({ win: MODERN_WIN, doc: { documentElement: {} }, ua: CHROME_UA }).status).toBe('PASS');
  });

  it('Fullscreen unsupported => FULLSCREEN_UNAVAILABLE event is reported by the monitor', () => {
    const report = vi.fn();
    const stop = createFullscreenMonitor(report); // jsdom has no requestFullscreen
    expect(report).toHaveBeenCalledWith('FULLSCREEN_UNAVAILABLE', { reason: 'unsupported' });
    stop();
  });

  it('unsupported page lists the missing features with instructions', () => {
    const support = getBrowserSupport({ win: { ...MODERN_WIN, indexedDB: undefined }, doc: FS_DOC, ua: CHROME_UA });
    render(<UnsupportedBrowserPage support={support} />);
    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /not supported/i })).toBeInTheDocument();
    expect(screen.getByText(/IndexedDB/)).toBeInTheDocument();
    expect(screen.getByText(/Chrome 126\.0\.0\.0/)).toBeInTheDocument();
    expect(screen.getByText(/latest Chrome, Edge, Firefox or Safari/)).toBeInTheDocument();
  });

  it('App renders the full-page unsupported message when a required API is missing', () => {
    const real = window.indexedDB;
    Object.defineProperty(window, 'indexedDB', { value: undefined, configurable: true });
    try {
      render(<App />);
      expect(screen.getByRole('heading', { name: /browser is not supported/i })).toBeInTheDocument();
    } finally { Object.defineProperty(window, 'indexedDB', { value: real, configurable: true }); }
  });

  it('App renders normally on a supported browser (home + system-check routes)', () => {
    const { unmount } = renderAt(<App />);
    expect(screen.getByText('SafeExam')).toBeInTheDocument();
    unmount();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ data: { status: 'ok' }, error: null }) }));
    renderAt(<App />, { route: '/system-check/practice' });
    expect(screen.getByRole('heading', { name: /practice system check/i })).toBeInTheDocument();
    vi.unstubAllGlobals();
  });

});
