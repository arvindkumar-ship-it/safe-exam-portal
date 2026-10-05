import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';

vi.mock('../../../api/eventApi.js', () => ({ sendEvents: vi.fn(async (_id, evs) => ({ source: 'WEB_CLIENT', acknowledgedUpTo: evs[evs.length - 1].clientSequence, accepted: evs.length, duplicates: 0, rejected: [] })) }));
vi.mock('../../../api/attemptApi.js', () => ({ heartbeat: vi.fn(async () => ({ serverTime: new Date().toISOString(), expiresAt: new Date(Date.now() + 3.6e6).toISOString(), attemptStatus: 'IN_PROGRESS' })) }));
let nativeCb = null;
vi.mock('../nativeBridgeAdapter.js', () => ({
  isNativeClient: () => true, bindNativeClient: async () => null, requestNativeExit: async () => ({ ok: false }),
  onNativeEvent: (cb) => { nativeCb = cb; return () => { nativeCb = null; }; },
}));

import { MonitoringContext, MonitoringProvider } from '../MonitoringProvider.jsx';
import WarningToast from '../WarningToast.jsx';
import MonitoringBanner from '../MonitoringBanner.jsx';
import ConsentNotice from '../ConsentNotice.jsx';
import AccessibilityNotice from '../AccessibilityNotice.jsx';
import { MESSAGES, WARNING_BY_EVENT } from '../policy.js';

afterEach(() => vi.useRealTimers());
const BAD_WORDS = /risk|fraud|cheat|score|severity|suspicious|guilty|violation/i;

function Harness({ value }) {
  const base = { lastWarning: null, lastWarningType: null, warningSeq: 0, eventCount: 0, enterFullscreen: vi.fn(), status: { fullscreen: true, online: true, queued: 0, lastUploadAt: null, blocked: false } };
  return <MonitoringContext.Provider value={{ ...base, ...value }}><WarningToast /></MonitoringContext.Provider>;
}

describe('B-20 warning toast', () => {
  it('shows the exact blur warning with an event count (no score)', () => {
    render(<Harness value={{ lastWarning: MESSAGES.blur, lastWarningType: 'WINDOW_BLUR', warningSeq: 1, eventCount: 3 }} />);
    expect(screen.getByRole('alert')).toHaveTextContent('Your exam window lost focus. This event has been recorded for review.');
    expect(screen.getByText('3 events recorded')).toBeInTheDocument();
  });

  it('singular count wording', () => {
    render(<Harness value={{ lastWarning: MESSAGES.blur, lastWarningType: 'WINDOW_BLUR', warningSeq: 1, eventCount: 1 }} />);
    expect(screen.getByText('1 event recorded')).toBeInTheDocument();
  });

  it('nothing is rendered when there is no warning', () => {
    const { container } = render(<Harness value={{}} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('repeated warnings are throttled to >= 10s apart', () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-04T10:00:00Z'));
    const v = (seq) => ({ lastWarning: MESSAGES.blur, lastWarningType: 'WINDOW_BLUR', warningSeq: seq, eventCount: seq });
    const { rerender } = render(<Harness value={v(1)} />);
    expect(screen.getByRole('alert')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss warning' }));
    expect(screen.queryByRole('alert')).toBeNull();
    act(() => { vi.advanceTimersByTime(3000); });
    rerender(<Harness value={v(2)} />);                 // 3s later: throttled
    expect(screen.queryByRole('alert')).toBeNull();
    act(() => { vi.advanceTimersByTime(8000); });
    rerender(<Harness value={v(3)} />);                 // 11s after the first: allowed
    expect(screen.getByRole('alert')).toBeInTheDocument();
  });

  it('exactly one role=alert at a time; auto-hides', () => {
    vi.useFakeTimers();
    render(<Harness value={{ lastWarning: MESSAGES.hidden, lastWarningType: 'PAGE_HIDDEN', warningSeq: 1, eventCount: 1 }} />);
    expect(screen.getAllByRole('alert')).toHaveLength(1);
    act(() => { vi.advanceTimersByTime(9000); });
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('fullscreen exit shows a Re-enter button that calls enterFullscreen', () => {
    const enterFullscreen = vi.fn();
    render(<Harness value={{ lastWarning: MESSAGES.fullscreenExit, lastWarningType: 'FULLSCREEN_EXIT', warningSeq: 1, eventCount: 1, enterFullscreen, status: { fullscreen: false, blocked: false } }} />);
    fireEvent.click(screen.getByRole('button', { name: 'Re-enter fullscreen' }));
    expect(enterFullscreen).toHaveBeenCalledOnce();
  });

  it('only the four documented events produce a warning', () => {
    expect(Object.keys(WARNING_BY_EVENT).sort()).toEqual(['CLIPBOARD_ATTEMPT', 'FULLSCREEN_EXIT', 'PAGE_HIDDEN', 'WINDOW_BLUR']);
  });

  it('student-facing wording never mentions risk/fraud/score/severity', () => {
    render(<><MonitoringBanner /><ConsentNotice /><AccessibilityNotice /></>);
    const all = [...Object.values(MESSAGES), document.body.textContent].join(' ');
    expect(all).not.toMatch(BAD_WORDS);
    expect(screen.getByRole('status')).toHaveTextContent(MESSAGES.banner);
  });

  it('banner explains blocked state when consent is missing', () => {
    render(<MonitoringContext.Provider value={{ status: { blocked: true } }}><MonitoringBanner /></MonitoringContext.Provider>);
    expect(screen.getByRole('status')).toHaveTextContent(/consent is required/i);
  });

  it('consent notice is transparent (what is / is not recorded; human review)', () => {
    render(<ConsentNotice />);
    expect(screen.getByRole('heading', { name: /monitoring notice/i })).toBeInTheDocument();
    expect(document.body.textContent).toMatch(/never record what you copy/i);
    expect(document.body.textContent).toMatch(/human review/i);
    expect(document.body.textContent).toMatch(/accessibility mode/i);
  });

  it('native events show the same toast (known type => its message, unknown => generic)', async () => {
    render(<MonitoringProvider attemptId="ux-native-1" policy={{}} consentGiven><WarningToast /></MonitoringProvider>);
    await waitFor(() => expect(nativeCb).toBeTypeOf('function'));
    act(() => nativeCb({ eventType: 'PAGE_HIDDEN' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(MESSAGES.hidden);
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss warning' }));
  });

  it('native event with unknown type falls back to the generic neutral message', async () => {
    render(<MonitoringProvider attemptId="ux-native-2" policy={{}} consentGiven><WarningToast /></MonitoringProvider>);
    await waitFor(() => expect(nativeCb).toBeTypeOf('function'));
    act(() => nativeCb({ eventType: 'UNAUTHORIZED_PROCESS' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(MESSAGES.generic);
  });

  it('real provider: a window blur produces the toast end to end', async () => {
    render(<MonitoringProvider attemptId="ux-real-1" policy={{}} consentGiven><WarningToast /></MonitoringProvider>);
    await waitFor(() => expect(nativeCb).toBeTypeOf('function')); // provider started
    act(() => { window.dispatchEvent(new Event('blur')); });
    expect(await screen.findByRole('alert')).toHaveTextContent(MESSAGES.blur);
  });
});
