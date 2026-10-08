import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';

vi.mock('../../../auth/useAuth.js', async () => {
  const bus = await import('../../../auth/tokenBus.js');
  return { useAuth: () => ({ accessToken: null, user: null, isAuthenticated: false }), onAccessTokenChange: bus.onAccessTokenChange };
});
vi.mock('../../../api/attemptApi.js', () => ({ saveAnswer: vi.fn(), submit: vi.fn(), heartbeat: vi.fn(), startAttempt: vi.fn(), getAttempt: vi.fn() }));
vi.mock('../../../api/eventApi.js', () => ({ sendEvents: vi.fn() }));
vi.mock('../nativeBridgeAdapter.js', () => ({
  isNativeClient: vi.fn(() => false), bindNativeClient: vi.fn(async () => null),
  onNativeEvent: vi.fn(() => () => {}), requestNativeExit: vi.fn(async () => ({ ok: false })),
}));

import * as attemptApi from '../../../api/attemptApi.js';
import { sendEvents } from '../../../api/eventApi.js';
import ExamShell, { AUTO_SUBMIT_ARM_MS } from '../../attempt/ExamShell.jsx';

let n = 0;
const attempt = (policy = {}) => ({
  id: `auto-${++n}`, status: 'IN_PROGRESS', expiresAt: new Date(Date.now() + 3600_000).toISOString(), serverTime: new Date().toISOString(),
  monitoringPolicy: { autoSubmitOnViolation: true, ...policy }, questions: [{ id: 'q1', type: 'SHORT_TEXT', marks: 1, prompt: 'Q' }],
});
const armed = () => act(async () => { await new Promise((r) => setTimeout(r, AUTO_SUBMIT_ARM_MS + 100)); });
const hide = () => { Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true }); fireEvent(document, new Event('visibilitychange')); };

beforeEach(() => {
  vi.mocked(attemptApi.saveAnswer).mockResolvedValue({ version: 1 });
  vi.mocked(attemptApi.submit).mockResolvedValue({ status: 'SUBMITTED' });
  vi.mocked(attemptApi.heartbeat).mockResolvedValue({ serverTime: new Date().toISOString(), expiresAt: new Date(Date.now() + 3600_000).toISOString(), attemptStatus: 'IN_PROGRESS' });
  vi.mocked(sendEvents).mockImplementation(async (_i, evs) => ({ source: 'WEB_CLIENT', acknowledgedUpTo: evs[evs.length - 1].clientSequence, accepted: evs.length, duplicates: 0, rejected: [] }));
  Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
});

describe('proctored auto-submit', () => {
  it('tab switch auto-submits with reason', async () => {
    const onSubmitted = vi.fn();
    render(<ExamShell attempt={attempt()} consentGiven onSubmitted={onSubmitted} />);
    await armed();
    hide();
    await waitFor(() => expect(attemptApi.submit).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(onSubmitted).toHaveBeenCalledWith(expect.objectContaining({ status: 'SUBMITTED', autoSubmitted: true, autoSubmitReason: expect.stringMatching(/tab/) })));
  });

  it('nothing happens when autoSubmitOnViolation is off', async () => {
    const onSubmitted = vi.fn();
    render(<ExamShell attempt={attempt({ autoSubmitOnViolation: false })} consentGiven onSubmitted={onSubmitted} />);
    await armed();
    hide();
    await new Promise((r) => setTimeout(r, 300));
    expect(attemptApi.submit).not.toHaveBeenCalled();
    expect(screen.queryByRole('note')).toBeNull();
  });

  it('retries until submit succeeds', async () => {
    vi.mocked(attemptApi.submit).mockRejectedValueOnce(new Error('net')).mockResolvedValue({ status: 'SUBMITTED' });
    const onSubmitted = vi.fn();
    render(<ExamShell attempt={attempt()} consentGiven onSubmitted={onSubmitted} />);
    await armed();
    hide();
    await waitFor(() => expect(onSubmitted).toHaveBeenCalled(), { timeout: 4000 });
    expect(attemptApi.submit).toHaveBeenCalledTimes(2);
  });

  describe('fullscreen gate', () => {
    const setFs = (on) => { Object.defineProperty(document, 'fullscreenElement', { value: on ? document.body : null, configurable: true }); fireEvent(document, new Event('fullscreenchange')); };
    beforeEach(() => { Object.defineProperty(document, 'fullscreenEnabled', { value: true, configurable: true }); setFs(false); });
    afterEach(() => { Object.defineProperty(document, 'fullscreenEnabled', { value: undefined, configurable: true }); });

    it('blocks the exam until fullscreen and ignores tab switch before that', async () => {
      render(<ExamShell attempt={attempt()} consentGiven onSubmitted={vi.fn()} />);
      expect(screen.getByRole('dialog', { name: /Enter fullscreen/ })).toBeInTheDocument();
      await armed();
      hide();
      await new Promise((r) => setTimeout(r, 300));
      expect(attemptApi.submit).not.toHaveBeenCalled();
    });

    it('leaving fullscreen after entering auto-submits', async () => {
      const onSubmitted = vi.fn();
      render(<ExamShell attempt={attempt()} consentGiven onSubmitted={onSubmitted} />);
      act(() => setFs(true));
      await waitFor(() => expect(screen.queryByRole('dialog', { name: /Enter fullscreen/ })).toBeNull());
      await armed();
      act(() => setFs(false));
      await waitFor(() => expect(onSubmitted).toHaveBeenCalledWith(expect.objectContaining({ autoSubmitted: true, autoSubmitReason: expect.stringMatching(/fullscreen/) })));
    });
  });
});
