import { StrictMode } from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { trackListeners } from '../../../test/listeners.js';

// Product A ka real useAuth AuthProvider maangta hai; shell tests ke liye chhota stub (token bus real).
vi.mock('../../../auth/useAuth.js', async () => {
  const bus = await import('../../../auth/tokenBus.js');
  return { useAuth: () => ({ accessToken: null, user: null, isAuthenticated: false }), onAccessTokenChange: bus.onAccessTokenChange };
});
vi.mock('../../../api/attemptApi.js', () => ({
  saveAnswer: vi.fn(), submit: vi.fn(), heartbeat: vi.fn(), startAttempt: vi.fn(), getAttempt: vi.fn(),
}));
vi.mock('../../../api/eventApi.js', () => ({ sendEvents: vi.fn() }));
vi.mock('../nativeBridgeAdapter.js', () => ({
  isNativeClient: vi.fn(() => false), bindNativeClient: vi.fn(async () => null),
  onNativeEvent: vi.fn(() => () => {}), requestNativeExit: vi.fn(async () => ({ ok: false })),
}));

import * as attemptApi from '../../../api/attemptApi.js';
import { sendEvents } from '../../../api/eventApi.js';
import * as native from '../nativeBridgeAdapter.js';
import ExamShell from '../../attempt/ExamShell.jsx';

let n = 0;
const makeAttempt = (o = {}) => ({
  id: `shell-attempt-${++n}`, status: 'IN_PROGRESS',
  expiresAt: new Date(Date.now() + 3600_000).toISOString(), serverTime: new Date().toISOString(),
  monitoringPolicy: {},
  questions: [
    { id: 'q1', type: 'MCQ_SINGLE', marks: 1, prompt: 'What is **2+2**?', options: [{ id: 'a', text: 'Three' }, { id: 'b', text: 'Four' }] },
    { id: 'q2', type: 'SHORT_TEXT', marks: 1, prompt: 'Explain <img src=x onerror=alert(1)> briefly' },
  ],
  ...o,
});
const setup = (attempt = makeAttempt(), props = {}) => {
  const onSubmitted = vi.fn();
  const utils = render(<ExamShell attempt={attempt} consentGiven onSubmitted={onSubmitted} {...props} />);
  return { onSubmitted, attempt, ...utils };
};

beforeEach(() => {
  vi.mocked(attemptApi.saveAnswer).mockResolvedValue({ version: 1 });
  vi.mocked(attemptApi.submit).mockResolvedValue({ status: 'SUBMITTED' });
  vi.mocked(attemptApi.heartbeat).mockResolvedValue({ serverTime: new Date().toISOString(), expiresAt: new Date(Date.now() + 3600_000).toISOString(), attemptStatus: 'IN_PROGRESS' });
  vi.mocked(sendEvents).mockImplementation(async (_id, evs) => ({ source: 'WEB_CLIENT', acknowledgedUpTo: evs[evs.length - 1].clientSequence, accepted: evs.length, duplicates: 0, rejected: [] }));
  vi.mocked(native.isNativeClient).mockReturnValue(false);
  vi.mocked(native.bindNativeClient).mockClear();
});

describe('B-17 web exam shell', () => {
  it('question navigation preserves answers', () => {
    setup();
    fireEvent.click(screen.getByLabelText('Four'));
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    expect(screen.getByText('Question 2 of 2')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Answer for question 2'), { target: { value: 'my text' } });
    fireEvent.click(screen.getByRole('button', { name: 'Previous' }));
    expect(screen.getByLabelText('Four')).toBeChecked();
    fireEvent.click(screen.getByRole('button', { name: /Question 2, answered/ }));
    expect(screen.getByLabelText('Answer for question 2')).toHaveValue('my text');
  });

  it('shows timer, save status, online state, monitoring banner and fullscreen state', () => {
    setup();
    expect(screen.getByRole('timer', { name: 'Time remaining' })).toHaveTextContent(/\d{2}:\d{2}/);
    expect(screen.getByText('No changes yet')).toBeInTheDocument();
    expect(screen.getByText('Online')).toBeInTheDocument();
    expect(screen.getByText('Fullscreen off')).toBeInTheDocument();
    expect(screen.getByText('Exam monitoring is active. Focus changes and fullscreen exits may be recorded for review.')).toBeInTheDocument();
  });

  it('hides fullscreen state when policy does not require fullscreen', () => {
    setup(makeAttempt({ monitoringPolicy: { fullscreen: false } }));
    expect(screen.queryByText(/Fullscreen (on|off)/)).toBeNull();
  });

  it('autosaves and shows saved status; save failure is visible with retry', async () => {
    setup();
    fireEvent.click(screen.getByLabelText('Four'));
    await waitFor(() => expect(screen.getByText('All answers saved')).toBeInTheDocument(), { timeout: 3000 });
    expect(attemptApi.saveAnswer).toHaveBeenCalledWith(expect.any(String), 'q1', { answerValue: 'b', version: 0 });

    vi.mocked(attemptApi.saveAnswer).mockRejectedValue(new Error('500'));
    fireEvent.click(screen.getByLabelText('Three'));
    await waitFor(() => expect(screen.getByText(/Save failed/)).toBeInTheDocument(), { timeout: 3000 });
    expect(screen.getByRole('button', { name: 'Retry now' })).toBeInTheDocument();
  });

  it('submit asks for confirmation; cancel keeps exam; confirm submits once with idempotency key', async () => {
    const { onSubmitted } = setup();
    fireEvent.click(screen.getByRole('button', { name: 'Submit exam' }));
    const dialog = screen.getByRole('dialog', { name: 'Submit your exam?' });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(attemptApi.submit).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Submit exam' }));
    fireEvent.click(screen.getByRole('button', { name: 'Confirm submit' }));
    await waitFor(() => expect(onSubmitted).toHaveBeenCalledTimes(1));
    expect(attemptApi.submit).toHaveBeenCalledTimes(1);
    expect(attemptApi.submit.mock.calls[0][1]).toMatch(/[0-9a-f-]{20,}/i);
    expect(onSubmitted.mock.calls[0][0].status).toBe('SUBMITTED');
  });

  it('submit failure shows a calm error and keeps the exam open', async () => {
    vi.mocked(attemptApi.submit).mockRejectedValue(new Error('500'));
    const { onSubmitted } = setup();
    fireEvent.click(screen.getByRole('button', { name: 'Submit exam' }));
    fireEvent.click(screen.getByRole('button', { name: 'Confirm submit' }));
    expect(await screen.findByText(/Could not submit right now/)).toBeInTheDocument();
    expect(onSubmitted).not.toHaveBeenCalled();
  });

  it('keyboard: Alt+Arrow navigates, modal focuses confirm and Escape closes it, skip link exists', () => {
    setup();
    const main = screen.getByRole('main', { name: 'Exam question' });
    fireEvent.keyDown(main, { key: 'ArrowRight', altKey: true });
    expect(screen.getByText('Question 2 of 2')).toBeInTheDocument();
    fireEvent.keyDown(main, { key: 'ArrowLeft', altKey: true });
    expect(screen.getByText('Question 1 of 2')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Skip to question' })).toHaveAttribute('href', '#exam-main');
    fireEvent.click(screen.getByRole('button', { name: 'Submit exam' }));
    expect(screen.getByRole('button', { name: 'Confirm submit' })).toHaveFocus();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('ARIA: navigation, main, timer, aria-current on active question', () => {
    setup();
    const nav = screen.getByRole('navigation', { name: 'Question navigation' });
    expect(within(nav).getByRole('button', { name: 'Question 1' })).toHaveAttribute('aria-current', 'step');
    expect(screen.getByRole('main', { name: 'Exam question' })).toHaveAttribute('data-exam-content');
  });

  it('question prompt HTML is escaped (rendered as text); no raw HTML injection', () => {
    const { container } = setup();
    expect(container.querySelector('strong')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    expect(container.querySelector('img')).toBeNull();
    expect(screen.getByText(/<img src=x onerror=alert\(1\)>/)).toBeInTheDocument();
  });

  it('monitoring provider is mounted once (also under StrictMode double-mount)', async () => {
    const t = trackListeners(window);
    const attempt = makeAttempt();
    render(<StrictMode><ExamShell attempt={attempt} consentGiven onSubmitted={vi.fn()} /></StrictMode>);
    await waitFor(() => expect(t.count('blur')).toBeGreaterThan(0));
    await new Promise((r) => setTimeout(r, 50));
    expect(t.count('blur')).toBe(1);
    expect(t.count('offline')).toBeGreaterThanOrEqual(1);
  });

  it('consent missing => monitoring blocked banner, no monitor listeners', async () => {
    const t = trackListeners(window);
    render(<ExamShell attempt={makeAttempt()} consentGiven={false} onSubmitted={vi.fn()} />);
    await new Promise((r) => setTimeout(r, 30));
    expect(screen.getByText('Monitoring consent is required to start the exam.')).toBeInTheDocument();
    expect(t.count('blur')).toBe(0);
  });

  it('native client present => bindNativeClient called with attemptId; absent => never called', () => {
    vi.mocked(native.isNativeClient).mockReturnValue(true);
    const { attempt, unmount } = setup();
    expect(native.bindNativeClient).toHaveBeenCalledWith({ attemptId: attempt.id, accessToken: null });
    unmount();
    vi.mocked(native.bindNativeClient).mockClear();
    vi.mocked(native.isNativeClient).mockReturnValue(false);
    setup();
    expect(native.bindNativeClient).not.toHaveBeenCalled();
  });

  it('token refresh re-binds the native client with the new token', async () => {
    vi.mocked(native.isNativeClient).mockReturnValue(true);
    const { emitAccessToken } = await import('../../../auth/tokenBus.js');
    const { attempt } = setup();
    expect(native.bindNativeClient).toHaveBeenCalledTimes(1);
    emitAccessToken('fresh-token'); // AuthProvider refresh ke baad yehi bus fire karta hai
    expect(native.bindNativeClient).toHaveBeenLastCalledWith({ attemptId: attempt.id, accessToken: 'fresh-token' });
  });

  it('submit => final flush of pending events BEFORE onSubmitted, monitors stopped', async () => {
    const t = trackListeners(window);
    const order = [];
    vi.mocked(sendEvents).mockImplementation(async (_id, evs) => { order.push('flush'); return { source: 'WEB_CLIENT', acknowledgedUpTo: evs[evs.length - 1].clientSequence, accepted: evs.length, duplicates: 0, rejected: [] }; });
    const onSubmitted = vi.fn(() => order.push('submitted'));
    render(<ExamShell attempt={makeAttempt()} consentGiven onSubmitted={onSubmitted} />);
    await waitFor(() => expect(t.count('blur')).toBe(1));
    fireEvent.blur(window); // creates a WINDOW_BLUR event
    fireEvent.click(screen.getByRole('button', { name: 'Submit exam' }));
    fireEvent.click(screen.getByRole('button', { name: 'Confirm submit' }));
    await waitFor(() => expect(onSubmitted).toHaveBeenCalled());
    const sent = vi.mocked(sendEvents).mock.calls.flatMap((c) => c[1]).map((e) => e.eventType);
    expect(sent).toContain('WINDOW_BLUR');
    expect(order.indexOf('flush')).toBeLessThan(order.indexOf('submitted'));
    expect(t.count('blur')).toBe(0); // monitors stopped after submit
  });

  it('terminal status from heartbeat finishes the shell without the student submitting', async () => {
    const real = globalThis.setTimeout;
    vi.spyOn(globalThis, 'setTimeout').mockImplementation((fn, ms, ...rest) => real(fn, ms >= 13000 && ms <= 17000 ? 10 : ms, ...rest)); // speed up the 15s heartbeat
    vi.mocked(attemptApi.heartbeat).mockResolvedValue({ serverTime: new Date().toISOString(), expiresAt: new Date().toISOString(), attemptStatus: 'AUTO_SUBMITTED' });
    const { onSubmitted } = setup();
    await waitFor(() => expect(onSubmitted).toHaveBeenCalledTimes(1), { timeout: 3000 });
    expect(onSubmitted.mock.calls[0][0].status).toBe('AUTO_SUBMITTED');
    expect(attemptApi.submit).not.toHaveBeenCalled();
  });
});
