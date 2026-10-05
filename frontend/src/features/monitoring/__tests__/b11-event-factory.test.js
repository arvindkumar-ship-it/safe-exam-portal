import { describe, it, expect } from 'vitest';
import { createEventFactory, assertValidEvent, sanitizeMetadata, MAX_METADATA_BYTES } from '../events/eventFactory.js';
import { openEventStore } from '../events/indexedDbEventStore.js';

const fixedNow = () => new Date('2026-10-04T18:40:00.000Z');
const make = (opts = {}) => createEventFactory({ attemptId: 'a1', now: fixedNow, ...opts });

describe('B-11 event factory (hardened)', () => {
  it('has all required fields and WEB_CLIENT source', () => {
    const e = make().create('FULLSCREEN_EXIT');
    expect(Object.keys(e).sort()).toEqual(['clientSequence', 'eventType', 'metadata', 'occurredAt', 'source']);
    expect(e.source).toBe('WEB_CLIENT');
    expect(assertValidEvent(e)).toBe(true);
  });

  it('rejects unknown and native-only event types', () => {
    const f = make();
    expect(() => f.create('STUDENT_CHEATED')).toThrow();
    expect(() => f.create('UNAUTHORIZED_PROCESS')).toThrow(); // native-only
  });

  it('caps metadata size (<= 2048 bytes), key count and string length', () => {
    const big = {};
    for (let i = 0; i < 50; i++) big[`k${i}`] = 'x'.repeat(500);
    const m = sanitizeMetadata(big);
    expect(Object.keys(m).length).toBeLessThanOrEqual(20);
    expect(new TextEncoder().encode(JSON.stringify(m)).length).toBeLessThanOrEqual(MAX_METADATA_BYTES);
    expect(sanitizeMetadata({ a: 'y'.repeat(999) }).a.length).toBe(200);
  });

  it('drops functions, DOM nodes and forbidden (clipboard/token) keys', () => {
    const m = sanitizeMetadata({
      fn: () => 1, node: document.body, text: 'secret copied text', token: 't', password: 'p', clipboardData: 'c', ok: 'yes',
    });
    expect(m).toEqual({ ok: 'yes' });
  });

  it('increments sequence and restores from a start value', () => {
    const f = make();
    expect([f.create('PAGE_HIDDEN').clientSequence, f.create('PAGE_VISIBLE').clientSequence]).toEqual([1, 2]);
    expect(f.peekSequence()).toBe(3);
    expect(make({ startSequence: 41 }).create('WINDOW_BLUR').clientSequence).toBe(41);
  });

  it('restores sequence from the IndexedDB store (lastSequence + 1)', async () => {
    const store = await openEventStore('restore-attempt');
    const f1 = createEventFactory({ attemptId: 'restore-attempt', now: fixedNow });
    for (let i = 0; i < 3; i++) await store.put(f1.create('WINDOW_BLUR'));
    const f2 = createEventFactory({ attemptId: 'restore-attempt', now: fixedNow, startSequence: (await store.lastSequence()) + 1 });
    expect(f2.create('WINDOW_FOCUS').clientSequence).toBe(4);
  });

  it('uses ISO UTC timestamp', () => {
    expect(make().create('PAGE_HIDDEN').occurredAt).toBe('2026-10-04T18:40:00.000Z');
    expect(() => assertValidEvent({ ...make().create('PAGE_HIDDEN'), occurredAt: '04/10/2026' })).toThrow();
  });

  it('never carries a client severity field; assertValidEvent rejects extras', () => {
    const e = make().create('CLIPBOARD_ATTEMPT', { action: 'copy', severity: 'HIGH' });
    expect(e).not.toHaveProperty('severity');
    expect(() => assertValidEvent({ ...e, severity: 'HIGH' })).toThrow(/unexpected field/);
    expect(() => assertValidEvent({ ...e, clientSequence: 0 })).toThrow();
    expect(() => assertValidEvent({ ...e, source: 'NATIVE_CLIENT' })).toThrow();
  });
});
