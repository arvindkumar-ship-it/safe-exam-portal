import { describe, it, expect, vi, afterEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { useOfflineRecovery, backoffDelayMs, OFFLINE_MESSAGE, CLOSED_MESSAGE } from '../useOfflineRecovery.js';
import { createAnswerQueue } from '../offline/answerQueue.js';
import { ApiError } from '../../../api/client.js';

afterEach(() => vi.useRealTimers());
const okHb = (o = {}) => ({ serverTime: '2026-10-04T10:00:00.000Z', expiresAt: '2026-10-04T11:00:00.000Z', attemptStatus: 'IN_PROGRESS', ...o });

function setup(overrides = {}, initialOnline = false) {
  const calls = [];
  const props = {
    heartbeat: vi.fn(async () => { calls.push('heartbeat'); return okHb(); }),
    onServerTime: vi.fn(() => calls.push('serverTime')),
    flushAnswers: vi.fn(async () => { calls.push('answers'); }),
    flushEvents: vi.fn(async () => { calls.push('events'); }),
    discardAnswers: vi.fn(async () => { calls.push('discard'); }),
    onTerminal: vi.fn(() => calls.push('terminal')),
    ...overrides,
  };
  const hook = renderHook(({ online }) => useOfflineRecovery({ online, ...props }), { initialProps: { online: initialOnline } });
  return { calls, props, ...hook };
}

describe('B-23 offline recovery', () => {
  it('shows the offline banner while disconnected, none when online', () => {
    const { result, rerender } = setup();
    expect(result.current.offline).toBe(true);
    expect(result.current.bannerMessage).toBe('Offline — answers are saved on this device');
    expect(result.current.bannerMessage).toBe(OFFLINE_MESSAGE);
    rerender({ online: true });
    return waitFor(() => expect(result.current.bannerMessage).toBeNull());
  });

  it('does nothing on first mount when already online', async () => {
    const { props } = setup({}, true);
    await new Promise((r) => setTimeout(r, 30));
    expect(props.heartbeat).not.toHaveBeenCalled();
  });

  it('reconnect runs in the exact order: heartbeat sync -> answers flush -> events flush', async () => {
    const { calls, rerender, result } = setup();
    rerender({ online: true });
    await waitFor(() => expect(calls).toContain('events'));
    expect(calls).toEqual(['heartbeat', 'serverTime', 'answers', 'events']);
    await waitFor(() => expect(result.current.recovering).toBe(false));
  });

  it('server time and expiry from the reconnect heartbeat are passed on', async () => {
    const { props, rerender } = setup();
    rerender({ online: true });
    await waitFor(() => expect(props.onServerTime).toHaveBeenCalledWith('2026-10-04T10:00:00.000Z', '2026-10-04T11:00:00.000Z'));
  });

  it('attempt closed by server while offline => answers discarded, notice shown, shell told, nothing flushed', async () => {
    const { props, rerender, result } = setup({ heartbeat: vi.fn(async () => okHb({ attemptStatus: 'AUTO_SUBMITTED' })) });
    rerender({ online: true });
    await waitFor(() => expect(props.onTerminal).toHaveBeenCalledWith('AUTO_SUBMITTED'));
    expect(props.discardAnswers).toHaveBeenCalledOnce();
    expect(props.flushAnswers).not.toHaveBeenCalled();
    expect(props.flushEvents).not.toHaveBeenCalled();
    expect(result.current.notice).toBe(CLOSED_MESSAGE);
  });

  it('heartbeat error ATTEMPT_EXPIRED / ATTEMPT_ALREADY_SUBMITTED is also treated as terminal', async () => {
    for (const [code, status] of [['ATTEMPT_EXPIRED', 'AUTO_SUBMITTED'], ['ATTEMPT_ALREADY_SUBMITTED', 'SUBMITTED'], ['ATTEMPT_NOT_ACTIVE', 'TERMINATED']]) {
      const { props, rerender, unmount } = setup({ heartbeat: vi.fn().mockRejectedValue(new ApiError(code, code, 409)) });
      rerender({ online: true });
      await waitFor(() => expect(props.onTerminal).toHaveBeenCalledWith(status));
      unmount();
    }
  });

  it('offline longer than the grace period only escalates the banner; never terminates or flushes', async () => {
    vi.useFakeTimers();
    const { result, props } = setup({}, false);
    expect(result.current.escalated).toBe(false);
    await act(async () => { await vi.advanceTimersByTimeAsync(301_000); });
    expect(result.current.escalated).toBe(true);
    expect(result.current.bannerMessage).toMatch(/offline for over 5 minutes/);
    expect(result.current.bannerMessage).toMatch(/not ended/i);
    expect(props.onTerminal).not.toHaveBeenCalled();
    expect(props.discardAnswers).not.toHaveBeenCalled();
    expect(props.heartbeat).not.toHaveBeenCalled();
  });

  it('grace period is configurable via policy.offlineGraceSeconds', async () => {
    vi.useFakeTimers();
    const calls = [];
    const { result } = renderHook(() => useOfflineRecovery({ online: false, graceSeconds: 10, heartbeat: async () => okHb() }));
    void calls;
    await act(async () => { await vi.advanceTimersByTimeAsync(9000); });
    expect(result.current.escalated).toBe(false);
    await act(async () => { await vi.advanceTimersByTimeAsync(2000); });
    expect(result.current.escalated).toBe(true);
  });

  it('backoff schedule is 1,2,4,8,16,30,30 seconds', () => {
    expect([0, 1, 2, 3, 4, 5, 6, 10].map(backoffDelayMs)).toEqual([1000, 2000, 4000, 8000, 16000, 30000, 30000, 30000]);
  });

  it('failed reconnect heartbeat retries with exponential backoff, then recovers in order', async () => {
    vi.useFakeTimers();
    const calls = [];
    let fails = 3;
    const heartbeat = vi.fn(async () => { if (fails-- > 0) throw new ApiError('NETWORK_ERROR', 'NETWORK_ERROR', 409); calls.push('heartbeat'); return okHb(); });
    const { rerender, props } = setup({ heartbeat, flushAnswers: vi.fn(async () => { calls.push('answers'); }), flushEvents: vi.fn(async () => { calls.push('events'); }) });
    rerender({ online: true });
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });  expect(heartbeat).toHaveBeenCalledTimes(1);
    await act(async () => { await vi.advanceTimersByTimeAsync(999); }); expect(heartbeat).toHaveBeenCalledTimes(1);
    await act(async () => { await vi.advanceTimersByTimeAsync(1); });   expect(heartbeat).toHaveBeenCalledTimes(2); // +1s
    await act(async () => { await vi.advanceTimersByTimeAsync(2000); }); expect(heartbeat).toHaveBeenCalledTimes(3); // +2s
    await act(async () => { await vi.advanceTimersByTimeAsync(4000); }); expect(heartbeat).toHaveBeenCalledTimes(4); // +4s => success
    expect(calls).toEqual(['heartbeat', 'answers', 'events']);
    expect(props.onTerminal).not.toHaveBeenCalled();
  });

  it('going offline again mid-recovery cancels the pending retry', async () => {
    vi.useFakeTimers();
    const heartbeat = vi.fn().mockRejectedValue(new ApiError('NETWORK_ERROR', 'NETWORK_ERROR', 409));
    const { rerender } = setup({ heartbeat });
    rerender({ online: true });
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    rerender({ online: false });
    const before = heartbeat.mock.calls.length;
    await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });
    expect(heartbeat.mock.calls.length).toBe(before);
  });

  it('answers written offline survive a refresh and are flushed after reconnect', async () => {
    const id = 'offline-refresh-1';
    const q1 = createAnswerQueue(id);
    await q1.enqueue('q1', 'typed while offline');
    const q2 = createAnswerQueue(id); await q2.load();           // page refresh while still offline
    const save = vi.fn().mockResolvedValue({ version: 1 });
    const { rerender } = setup({ flushAnswers: () => q2.flush(save) });
    rerender({ online: true });
    await waitFor(() => expect(save).toHaveBeenCalledWith('q1', { answerValue: 'typed while offline', version: 0 }));
  });
});
