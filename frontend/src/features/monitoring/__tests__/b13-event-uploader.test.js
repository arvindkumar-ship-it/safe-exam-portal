import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventQueue } from '../events/eventQueue.js';
import { createMemoryStore } from '../events/indexedDbEventStore.js';
import { createEventUploader } from '../events/eventUploader.js';
import { sendEvents } from '../../../api/eventApi.js';
import { ApiError, setTokenProvider } from '../../../api/client.js';

const evt = (seq) => ({ eventType: 'WINDOW_BLUR', source: 'WEB_CLIENT', occurredAt: '2026-10-04T18:40:00.000Z', clientSequence: seq, metadata: {} });
async function fill(n) {
  const q = new EventQueue(createMemoryStore()); await q.init();
  for (let i = 1; i <= n; i++) await q.add(evt(i));
  return q;
}
const ok = (upTo, extra = {}) => ({ source: 'WEB_CLIENT', acknowledgedUpTo: upTo, accepted: upTo, duplicates: 0, rejected: [], ...extra });

beforeEach(() => { vi.spyOn(console, 'warn').mockImplementation(() => {}); });
afterEach(() => { vi.useRealTimers(); setTokenProvider(null); });

describe('B-13 event uploader', () => {
  it('successful upload removes acknowledged events', async () => {
    const q = await fill(3);
    const send = vi.fn().mockResolvedValue(ok(3));
    const onUploaded = vi.fn();
    const up = createEventUploader({ queue: q, attemptId: 'a1', sendEvents: send, onUploaded });
    expect(await up.flush()).toBe(true);
    expect(send).toHaveBeenCalledWith('a1', expect.any(Array));
    expect(q.size()).toBe(0);
    expect(onUploaded).toHaveBeenCalledOnce();
  });

  it('API failure keeps events and flush reports false', async () => {
    const q = await fill(2);
    const send = vi.fn().mockRejectedValue(new ApiError('NETWORK_ERROR', 'NETWORK_ERROR', 0));
    const up = createEventUploader({ queue: q, attemptId: 'a1', sendEvents: send });
    expect(await up.flush()).toBe(false);
    expect(q.size()).toBe(2);
  });

  it('backs off exponentially 1s -> 2s -> 4s on repeated failure, caps at 30s', async () => {
    vi.useFakeTimers();
    const q = await fill(1);
    const send = vi.fn().mockRejectedValue(new ApiError('HTTP_503', 'unavailable', 503));
    const up = createEventUploader({ queue: q, attemptId: 'a1', sendEvents: send, intervalMs: 5000 });
    up.start();
    await vi.advanceTimersByTimeAsync(5000); expect(send).toHaveBeenCalledTimes(1);   // first tick
    await vi.advanceTimersByTimeAsync(999);  expect(send).toHaveBeenCalledTimes(1);   // waiting 1s
    await vi.advanceTimersByTimeAsync(1);    expect(send).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1999); expect(send).toHaveBeenCalledTimes(2);   // waiting 2s
    await vi.advanceTimersByTimeAsync(1);    expect(send).toHaveBeenCalledTimes(3);
    await vi.advanceTimersByTimeAsync(4000); expect(send).toHaveBeenCalledTimes(4);   // 4s
    for (let i = 0; i < 6; i++) await vi.advanceTimersByTimeAsync(30000);              // never more than 30s apart
    expect(send.mock.calls.length).toBeGreaterThanOrEqual(8);
    up.stop();
  });

  it('RATE_LIMITED keeps events (retry later)', async () => {
    const q = await fill(2);
    const send = vi.fn().mockRejectedValue(new ApiError('RATE_LIMITED', 'RATE_LIMITED', 429));
    const up = createEventUploader({ queue: q, attemptId: 'a1', sendEvents: send });
    expect(await up.flush()).toBe(false);
    expect(q.size()).toBe(2);
  });

  it('partial ack removes only events up to the ack', async () => {
    const q = await fill(5);
    const send = vi.fn().mockResolvedValueOnce(ok(2)).mockRejectedValue(new ApiError('NETWORK_ERROR', 'NETWORK_ERROR', 0));
    const up = createEventUploader({ queue: q, attemptId: 'a1', sendEvents: send });
    await up.flush();
    expect((await q.getBatch(10)).map((e) => e.clientSequence)).toEqual([3, 4, 5]);
  });

  it('duplicate upload is safe (server reports duplicates, queue still cleared)', async () => {
    const q = await fill(2);
    const send = vi.fn().mockResolvedValue(ok(2, { accepted: 0, duplicates: 2 }));
    const up = createEventUploader({ queue: q, attemptId: 'a1', sendEvents: send });
    expect(await up.flush()).toBe(true);
    expect(q.size()).toBe(0);
  });

  it('expired auth is refreshed and the request retried (via apiRequest)', async () => {
    const refreshSession = vi.fn().mockResolvedValue();
    setTokenProvider({ getAccessToken: () => 'tok', refresh: refreshSession });
    const body = (data, error = null) => ({ ok: !error, status: error ? 401 : 200, json: async () => ({ data, error, requestId: 'r' }) });
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(body(null, { code: 'TOKEN_EXPIRED', message: 'expired' }))
      .mockResolvedValueOnce(body(ok(1)));
    vi.stubGlobal('fetch', fetchMock);
    try {
      const q = await fill(1);
      const up = createEventUploader({ queue: q, attemptId: 'a1', sendEvents });
      expect(await up.flush()).toBe(true);
      expect(refreshSession).toHaveBeenCalledOnce();
      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(JSON.parse(fetchMock.mock.calls[1][1].body).events).toHaveLength(1);
      expect(q.size()).toBe(0);
    } finally { vi.unstubAllGlobals(); }
  });

  it('permanently rejected events (EVENT_*) are dropped, others stay', async () => {
    const q = await fill(3);
    const send = vi.fn().mockResolvedValueOnce(ok(1, { rejected: [{ clientSequence: 2, code: 'EVENT_TYPE_UNKNOWN' }] }))
      .mockRejectedValue(new ApiError('NETWORK_ERROR', 'NETWORK_ERROR', 0)); // stop after first round
    const up = createEventUploader({ queue: q, attemptId: 'a1', sendEvents: send });
    await up.flush();
    expect((await q.getBatch(10)).map((e) => e.clientSequence)).toEqual([3]);
  });

  it('no-progress response (nothing acked) backs off instead of looping hot', async () => {
    const q = await fill(2);
    const send = vi.fn().mockResolvedValue(ok(0));
    const up = createEventUploader({ queue: q, attemptId: 'a1', sendEvents: send });
    expect(await up.flush()).toBe(false);
    expect(send).toHaveBeenCalledTimes(1);
    expect(q.size()).toBe(2);
  });

  it('whole batch rejected with an EVENT_* error is dropped (no infinite retry)', async () => {
    const q = await fill(2);
    const send = vi.fn().mockRejectedValueOnce(new ApiError('EVENT_MIXED_SOURCE', 'EVENT_MIXED_SOURCE', 422)).mockResolvedValue(ok(0));
    const up = createEventUploader({ queue: q, attemptId: 'a1', sendEvents: send });
    await up.flush();
    expect(q.size()).toBe(0);
  });

  it('ATTEMPT_NOT_ACTIVE marks terminal and stops the timer loop', async () => {
    vi.useFakeTimers();
    const q = await fill(1);
    const send = vi.fn().mockRejectedValue(new ApiError('ATTEMPT_NOT_ACTIVE', 'ATTEMPT_NOT_ACTIVE', 409));
    const up = createEventUploader({ queue: q, attemptId: 'a1', sendEvents: send, intervalMs: 1000 });
    up.start();
    await vi.advanceTimersByTimeAsync(1000);
    expect(up.isTerminal()).toBe(true);
    await vi.advanceTimersByTimeAsync(20000);
    expect(send).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('stop clears timers; start twice does not double-schedule', async () => {
    vi.useFakeTimers();
    const up = createEventUploader({ queue: await fill(0), attemptId: 'a1', sendEvents: vi.fn() });
    up.start(); up.start();
    expect(vi.getTimerCount()).toBe(1);
    up.stop();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('flush (unmount/submit) sends everything in several batches', async () => {
    const q = await fill(45);
    const send = vi.fn(async (_id, batch) => ok(batch[batch.length - 1].clientSequence));
    const up = createEventUploader({ queue: q, attemptId: 'a1', sendEvents: send, batchSize: 20 });
    expect(await up.flush()).toBe(true);
    expect(send).toHaveBeenCalledTimes(3);
    expect(q.size()).toBe(0);
  });

  it('parallel flush calls are serialized (no double send of same batch)', async () => {
    const q = await fill(3);
    const send = vi.fn(async (_id, batch) => ok(batch[batch.length - 1].clientSequence));
    const up = createEventUploader({ queue: q, attemptId: 'a1', sendEvents: send });
    await Promise.all([up.flush(), up.flush()]);
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('notify() flushes immediately once queue reaches batchSize', async () => {
    vi.useFakeTimers();
    const q = await fill(20);
    const send = vi.fn(async (_id, batch) => ok(batch[batch.length - 1].clientSequence));
    const up = createEventUploader({ queue: q, attemptId: 'a1', sendEvents: send, batchSize: 20, intervalMs: 60000 });
    up.start(); up.notify();
    await vi.advanceTimersByTimeAsync(0);
    expect(send).toHaveBeenCalledOnce();
    up.stop();
  });
});
