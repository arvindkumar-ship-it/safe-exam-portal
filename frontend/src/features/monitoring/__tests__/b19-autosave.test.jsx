import { describe, it, expect, vi, afterEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { createAnswerQueue, saveAnswerWithConflict } from '../offline/answerQueue.js';
import { encryptJson, decryptJson, getOrCreateKey } from '../offline/cryptoStore.js';
import { useAutosave } from '../../../hooks/useAutosave.js';
import { openDb, reqP } from '../../../utils/idb.js';

let n = 0;
const uid = () => `ans-attempt-${++n}`;
const setOnLine = (v) => { Object.defineProperty(navigator, 'onLine', { value: v, configurable: true }); window.dispatchEvent(new Event(v ? 'online' : 'offline')); };
afterEach(() => setOnLine(true));

async function rawRows(attemptId) {
  const db = await openDb('safeexam-answers', 1, () => {});
  const rows = await reqP(db.transaction('answers').objectStore('answers').getAll());
  return rows.filter((r) => r.attemptId === attemptId);
}

describe('B-19 cryptoStore', () => {
  it('round-trips JSON; blob is not plaintext; IV random per record', async () => {
    const a = await encryptJson({ answerValue: 'my secret answer' });
    const b = await encryptJson({ answerValue: 'my secret answer' });
    expect(a).not.toContain('secret'); expect(a).not.toBe(b);
    expect(a.split('.')[0]).not.toBe(b.split('.')[0]);
    expect(await decryptJson(a)).toEqual({ answerValue: 'my secret answer' });
  });
  it('IV is 12 bytes; key is AES-GCM 256 and not extractable; same key reused', async () => {
    const blob = await encryptJson({ x: 1 });
    expect(atob(blob.split('.')[0]).length).toBe(12);
    const key = await getOrCreateKey();
    expect(key.algorithm).toMatchObject({ name: 'AES-GCM', length: 256 });
    expect(key.extractable).toBe(false);
    expect(await getOrCreateKey()).toBe(key);
  });
  it('tampered blob fails to decrypt', async () => {
    const blob = await encryptJson({ x: 1 });
    const [iv, data] = blob.split('.');
    const bad = `${iv}.${data.slice(0, -4)}AAAA`;
    await expect(decryptJson(bad)).rejects.toBeTruthy();
  });
});

describe('B-19 answerQueue', () => {
  it('is encrypted at rest (stored blob != plaintext)', async () => {
    const id = uid();
    const q = createAnswerQueue(id);
    await q.enqueue('q1', 'TOP-SECRET-ANSWER');
    const rows = await rawRows(id);
    expect(rows).toHaveLength(1);
    expect(JSON.stringify(rows[0])).not.toContain('TOP-SECRET-ANSWER');
    expect(typeof rows[0].blob).toBe('string');
  });

  it('never touches localStorage', async () => {
    const set = vi.spyOn(Storage.prototype, 'setItem'); const get = vi.spyOn(Storage.prototype, 'getItem');
    const q = createAnswerQueue(uid());
    await q.enqueue('q1', 'a'); await q.flush(async () => ({ version: 1 }));
    expect(set).not.toHaveBeenCalled(); expect(get).not.toHaveBeenCalled();
  });

  it('latest value wins per question', async () => {
    const q = createAnswerQueue(uid());
    await q.enqueue('q1', 'first'); await q.enqueue('q1', 'second'); await q.enqueue('q1', 'third');
    expect(q.size()).toBe(1);
    const save = vi.fn().mockResolvedValue({ version: 1 });
    await q.flush(save);
    expect(save).toHaveBeenCalledTimes(1);
    expect(save.mock.calls[0][1].answerValue).toBe('third');
  });

  it('flushes sequentially in enqueue order, then empties (storage cleaned too)', async () => {
    const id = uid(); const q = createAnswerQueue(id);
    await q.enqueue('q2', 'b'); await q.enqueue('q1', 'a'); await q.enqueue('q3', 'c');
    const order = [];
    const res = await q.flush(async (qid) => { order.push(qid); return { version: 1 }; });
    expect(order).toEqual(['q2', 'q1', 'q3']);
    expect(res).toEqual({ flushed: 3, remaining: 0 });
    expect(await rawRows(id)).toHaveLength(0);
  });

  it('stops at first failure and keeps the rest', async () => {
    const q = createAnswerQueue(uid());
    await q.enqueue('q1', 'a'); await q.enqueue('q2', 'b'); await q.enqueue('q3', 'c');
    const save = vi.fn(async (qid) => { if (qid === 'q2') throw new Error('net'); return { version: 1 }; });
    const res = await q.flush(save);
    expect(res).toEqual({ flushed: 1, remaining: 2 });
    expect(q.has('q1')).toBe(false); expect(q.has('q2')).toBe(true);
  });

  it('version conflict => adopt server version and retry once', async () => {
    const versions = { q1: 1 };
    const save = vi.fn()
      .mockRejectedValueOnce(Object.assign(new Error('conflict'), { code: 'VERSION_CONFLICT', status: 409, details: { version: 7 } }))
      .mockResolvedValueOnce({ version: 8 });
    await saveAnswerWithConflict(save, 'q1', 'x', versions);
    expect(save).toHaveBeenCalledTimes(2);
    expect(save.mock.calls[1][1]).toEqual({ answerValue: 'x', version: 7 });
    expect(versions.q1).toBe(8);
  });

  it('conflict that persists is not retried forever; non-conflict errors rethrown', async () => {
    const conflict = Object.assign(new Error('c'), { status: 409, details: { version: 2 } });
    const save = vi.fn().mockRejectedValue(conflict);
    await expect(saveAnswerWithConflict(save, 'q', 'v', {})).rejects.toBe(conflict);
    expect(save).toHaveBeenCalledTimes(2);
    const boom = vi.fn().mockRejectedValue(new Error('500'));
    await expect(saveAnswerWithConflict(boom, 'q', 'v', {})).rejects.toThrow('500');
    expect(boom).toHaveBeenCalledTimes(1);
  });

  it('restart recovery: a new queue instance loads decrypted answers', async () => {
    const id = uid();
    const q1 = createAnswerQueue(id);
    await q1.enqueue('q1', 'persisted answer'); await q1.enqueue('q2', 'another');
    const q2 = createAnswerQueue(id); // "page refresh"
    await q2.load();
    expect(q2.size()).toBe(2);
    const save = vi.fn().mockResolvedValue({ version: 1 });
    await q2.flush(save);
    expect(save.mock.calls.map((c) => c[1].answerValue)).toEqual(['persisted answer', 'another']);
  });

  it('attempts are isolated; clear() wipes memory and storage', async () => {
    const a = uid(); const b = uid();
    const qa = createAnswerQueue(a); const qb = createAnswerQueue(b);
    await qa.enqueue('q1', 'A'); await qb.enqueue('q1', 'B');
    await qa.clear();
    expect(qa.size()).toBe(0);
    expect(await rawRows(a)).toHaveLength(0);
    expect(await rawRows(b)).toHaveLength(1);
  });
});

describe('B-19 useAutosave (offline-safe)', () => {
  it('online: saves after debounce and reports SAVED', async () => {
    const saveFn = vi.fn().mockResolvedValue({ version: 1 });
    const id = uid(); // stable id (new id per render would recreate the queue)
    const { result } = renderHook(() => useAutosave({ attemptId: id, saveFn, debounceMs: 10 }));
    act(() => result.current.queueAnswer('q1', 'hello'));
    expect(result.current.status).toBe('SAVING');
    await waitFor(() => expect(result.current.status).toBe('SAVED'));
    expect(saveFn).toHaveBeenCalledWith('q1', { answerValue: 'hello', version: 0 });
  });

  it('offline: status OFFLINE, nothing sent, answer encrypted; reconnect flushes', async () => {
    const id = uid();
    const saveFn = vi.fn().mockResolvedValue({ version: 1 });
    setOnLine(false);
    const { result } = renderHook(() => useAutosave({ attemptId: id, saveFn, debounceMs: 10 }));
    expect(result.current.status).toBe('OFFLINE');
    await act(async () => { result.current.queueAnswer('q1', 'written offline'); });
    await waitFor(async () => expect((await rawRows(id)).length).toBe(1));
    expect(saveFn).not.toHaveBeenCalled();
    expect(JSON.stringify(await rawRows(id))).not.toContain('written offline');
    act(() => setOnLine(true));
    await waitFor(() => expect(saveFn).toHaveBeenCalledWith('q1', { answerValue: 'written offline', version: 0 }));
    await waitFor(() => expect(result.current.status).toBe('SAVED'));
  });

  it('save failure => FAILED (visible) and retryNow recovers', async () => {
    let fail = true;
    const saveFn = vi.fn(async () => { if (fail) throw new Error('500'); return { version: 1 }; });
    const id = uid();
    const { result } = renderHook(() => useAutosave({ attemptId: id, saveFn, debounceMs: 5 }));
    act(() => result.current.queueAnswer('q1', 'x'));
    await waitFor(() => expect(result.current.status).toBe('FAILED'));
    fail = false;
    await act(async () => { await result.current.retryNow(); });
    expect(result.current.status).toBe('SAVED');
  });

  it('refresh while offline: answers survive and flush after restart', async () => {
    const id = uid();
    const q = createAnswerQueue(id); await q.enqueue('q1', 'survivor'); // from the previous page load
    const saveFn = vi.fn().mockResolvedValue({ version: 1 });
    renderHook(() => useAutosave({ attemptId: id, saveFn }));
    await waitFor(() => expect(saveFn).toHaveBeenCalledWith('q1', { answerValue: 'survivor', version: 0 }));
  });
});
