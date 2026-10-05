import { describe, it, expect } from 'vitest';
import { EventQueue } from '../events/eventQueue.js';
import { openEventStore, createMemoryStore } from '../events/indexedDbEventStore.js';
import { createEventFactory } from '../events/eventFactory.js';

let n = 0;
const uid = () => `q-attempt-${++n}`;
const evt = (seq) => ({ eventType: 'WINDOW_BLUR', source: 'WEB_CLIENT', occurredAt: '2026-10-04T18:40:00.000Z', clientSequence: seq, metadata: {} });
const seqs = (list) => list.map((e) => e.clientSequence);

async function newQueue(store) {
  const q = new EventQueue(store || (await openEventStore(uid())));
  await q.init();
  return q;
}

describe('B-12 event queue', () => {
  it('preserves FIFO order (even if added out of order)', async () => {
    const q = await newQueue();
    for (const s of [1, 2, 4, 3]) await q.add(evt(s));
    expect(seqs(await q.getBatch(10))).toEqual([1, 2, 3, 4]);
  });

  it('respects the batch limit', async () => {
    const q = await newQueue();
    for (let i = 1; i <= 30; i++) await q.add(evt(i));
    expect((await q.getBatch()).length).toBe(20); // default
    expect((await q.getBatch(5)).length).toBe(5);
    expect(q.size()).toBe(30);
  });

  it('getBatch does not remove events (failed upload keeps them)', async () => {
    const q = await newQueue();
    await q.add(evt(1)); await q.add(evt(2));
    await q.getBatch(2); // pretend upload failed
    expect(q.size()).toBe(2);
  });

  it('removes only acknowledged events (removeUpTo)', async () => {
    const q = await newQueue();
    for (let i = 1; i <= 5; i++) await q.add(evt(i));
    await q.removeUpTo(3);
    expect(seqs(await q.getBatch(10))).toEqual([4, 5]);
  });

  it('ignores duplicate clientSequence', async () => {
    const q = await newQueue();
    expect(await q.add(evt(1))).toBe(true);
    expect(await q.add(evt(1))).toBe(false);
    expect(q.size()).toBe(1);
  });

  it('recovers after restart (new queue over same IndexedDB store)', async () => {
    const id = uid();
    const q1 = new EventQueue(await openEventStore(id)); await q1.init();
    for (let i = 1; i <= 4; i++) await q1.add(evt(i));
    await q1.removeUpTo(2);
    const q2 = new EventQueue(await openEventStore(id)); await q2.init();
    expect(seqs(await q2.getBatch(10))).toEqual([3, 4]);
  });

  it('keeps last sequence even after ack removed everything', async () => {
    const id = uid();
    const store = await openEventStore(id);
    const q = new EventQueue(store); await q.init();
    for (let i = 1; i <= 3; i++) await q.add(evt(i));
    await q.removeUpTo(3);
    expect(q.size()).toBe(0);
    expect(await (await openEventStore(id)).lastSequence()).toBe(3);
  });

  it('isolates attempts from each other in the same DB', async () => {
    const a = new EventQueue(await openEventStore(uid())); await a.init();
    const b = new EventQueue(await openEventStore(uid())); await b.init();
    await a.add(evt(1));
    expect(b.size()).toBe(0);
  });

  it('removeSequences drops only the listed events', async () => {
    const q = await newQueue();
    for (let i = 1; i <= 4; i++) await q.add(evt(i));
    await q.removeSequences([2, 3]);
    expect(seqs(await q.getBatch(10))).toEqual([1, 4]);
  });

  it('memory store fallback works the same way', async () => {
    const store = createMemoryStore();
    const q = await newQueue(store);
    for (const s of [2, 1, 3]) await q.add(evt(s));
    await q.removeUpTo(1);
    expect(seqs(await q.getBatch(10))).toEqual([2, 3]);
    expect(await store.lastSequence()).toBe(3);
  });

  it('falls back to memory store when IndexedDB is unavailable', async () => {
    const real = globalThis.indexedDB;
    Object.defineProperty(globalThis, 'indexedDB', { value: undefined, configurable: true });
    try {
      const store = await openEventStore(uid());
      await store.put(evt(1));
      expect((await store.all()).length).toBe(1);
    } finally {
      Object.defineProperty(globalThis, 'indexedDB', { value: real, configurable: true });
    }
  });

  it('works with real factory events end to end', async () => {
    const q = await newQueue();
    const f = createEventFactory({ attemptId: 'x' });
    await q.add(f.create('PAGE_HIDDEN')); await q.add(f.create('PAGE_VISIBLE'));
    expect(seqs(await q.getBatch())).toEqual([1, 2]);
  });
});
