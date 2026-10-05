import { describe, it, expect, vi, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useTimer } from '../../../hooks/useTimer.js';
import { useServerClock } from '../../../hooks/useServerClock.js';

const T0 = new Date('2026-10-04T10:00:00.000Z').getTime();
const iso = (ms) => new Date(ms).toISOString();
afterEach(() => vi.useRealTimers());
const tick = (ms) => act(() => { vi.advanceTimersByTime(ms); });

describe('B-18 server-synced timer', () => {
  it('skewed client clock => remaining computed from server time', () => {
    vi.useFakeTimers(); vi.setSystemTime(T0); // client thinks 10:00
    const serverNow = T0 + 3600_000;           // server is 1h ahead
    const { result } = renderHook(() => useTimer({ expiresAt: iso(serverNow + 600_000), serverTime: iso(serverNow) }));
    expect(result.current.remainingSeconds).toBe(600);
    tick(5000);
    expect(result.current.remainingSeconds).toBe(595);
  });

  it('useServerClock: initial offset + heartbeat sync updates offset', () => {
    vi.useFakeTimers(); vi.setSystemTime(T0);
    const { result } = renderHook(() => useServerClock({ initialServerTime: iso(T0 + 2000) }));
    expect(result.current.offsetMs).toBe(2000);
    act(() => result.current.sync(iso(T0 + 7000)));
    expect(result.current.offsetMs).toBe(7000);
    act(() => result.current.sync('garbage')); // invalid ignored
    expect(result.current.offsetMs).toBe(7000);
  });

  it('timer uses the clock offset (heartbeat resync changes remaining)', () => {
    vi.useFakeTimers(); vi.setSystemTime(T0);
    const expiresAt = iso(T0 + 100_000);
    const { result } = renderHook(() => {
      const clock = useServerClock({ initialServerTime: iso(T0) });
      const t = useTimer({ expiresAt, offsetMs: clock.offsetMs });
      return { clock, t };
    });
    expect(result.current.t.remainingSeconds).toBe(100);
    act(() => result.current.clock.sync(iso(T0 + 40_000))); // server says 40s more elapsed
    expect(result.current.t.remainingSeconds).toBe(60);
  });

  it('tab throttling: big time jump (hidden tab) still gives the right value', () => {
    vi.useFakeTimers(); vi.setSystemTime(T0);
    const { result } = renderHook(() => useTimer({ expiresAt: iso(T0 + 300_000), serverTime: iso(T0) }));
    expect(result.current.remainingSeconds).toBe(300);
    vi.setSystemTime(T0 + 200_000);            // no interval ticks ran while "hidden"
    act(() => { document.dispatchEvent(new Event('visibilitychange')); });
    expect(result.current.remainingSeconds).toBe(100); // computed, not decremented
  });

  it('expiresAt change from heartbeat is reflected', () => {
    vi.useFakeTimers(); vi.setSystemTime(T0);
    const { result, rerender } = renderHook(({ exp }) => useTimer({ expiresAt: exp, serverTime: iso(T0) }), { initialProps: { exp: iso(T0 + 60_000) } });
    expect(result.current.remainingSeconds).toBe(60);
    rerender({ exp: iso(T0 + 120_000) }); // server extended the exam
    expect(result.current.remainingSeconds).toBe(120);
  });

  it('onExpire fires once at zero; never decides anything else', () => {
    vi.useFakeTimers(); vi.setSystemTime(T0);
    const onExpire = vi.fn();
    const { result } = renderHook(() => useTimer({ expiresAt: iso(T0 + 3000), serverTime: iso(T0), onExpire }));
    tick(2000); expect(onExpire).not.toHaveBeenCalled();
    tick(5000); expect(onExpire).toHaveBeenCalledTimes(1);
    tick(10_000); expect(onExpire).toHaveBeenCalledTimes(1);
    expect(result.current.isExpired).toBe(true);
    expect(result.current.remainingSeconds).toBe(0);
  });

  it('invalid expiresAt => 0 remaining, no crash', () => {
    const { result } = renderHook(() => useTimer({ expiresAt: 'nope' }));
    expect(result.current.remainingSeconds).toBe(0);
  });

  it('cleanup removes interval and visibility listener', () => {
    vi.useFakeTimers(); vi.setSystemTime(T0);
    const rm = vi.spyOn(document, 'removeEventListener');
    const { unmount } = renderHook(() => useTimer({ expiresAt: iso(T0 + 60_000), serverTime: iso(T0) }));
    unmount();
    expect(rm).toHaveBeenCalledWith('visibilitychange', expect.any(Function));
    expect(vi.getTimerCount()).toBe(0);
  });
});
