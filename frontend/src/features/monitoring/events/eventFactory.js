import { isWebEventType } from './eventTypes.js';

export const MAX_METADATA_BYTES = 2048;
const MAX_KEYS = 20;
const MAX_STRING = 200;
// R5: in naam ke keys kabhi metadata me nahi jayenge (clipboard text, passwords, tokens).
const FORBIDDEN_KEY = /^(text|content|clipboard\w*|password\w*|token|\w*token|secret\w*|email|name)$/i;
const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/;

const byteLength = (s) => new TextEncoder().encode(s).length;
const isDomNode = (v) => typeof Node !== 'undefined' && v instanceof Node;

function cleanValue(v, depth) {
  if (v === null) return null;
  const t = typeof v;
  if (t === 'string') return v.length > MAX_STRING ? v.slice(0, MAX_STRING) : v;
  if (t === 'number') return Number.isFinite(v) ? v : undefined;
  if (t === 'boolean') return v;
  if (t === 'function' || t === 'symbol' || t === 'undefined' || t === 'bigint') return undefined;
  if (isDomNode(v) || (typeof Window !== 'undefined' && v instanceof Window)) return undefined;
  if (depth >= 2) return undefined;
  if (Array.isArray(v)) return v.slice(0, 10).map((x) => cleanValue(x, depth + 1)).filter((x) => x !== undefined);
  if (t === 'object') {
    const out = {};
    for (const [k, val] of Object.entries(v).slice(0, MAX_KEYS)) {
      if (FORBIDDEN_KEY.test(k)) continue;
      const c = cleanValue(val, depth + 1);
      if (c !== undefined) out[k] = c;
    }
    return out;
  }
  return undefined;
}

export function sanitizeMetadata(metadata) {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return {};
  const out = {};
  for (const [k, v] of Object.entries(metadata)) {
    if (Object.keys(out).length >= MAX_KEYS) break;
    if (FORBIDDEN_KEY.test(k)) continue;
    const c = cleanValue(v, 0);
    if (c !== undefined) out[k] = c;
  }
  // size cap: last keys pehle hatao
  let keys = Object.keys(out);
  while (keys.length && byteLength(JSON.stringify(out)) > MAX_METADATA_BYTES) {
    delete out[keys.pop()];
  }
  return out;
}

export function createEventFactory({ attemptId, source = 'WEB_CLIENT', now = () => new Date(), startSequence = 1 } = {}) {
  let seq = Math.max(1, Number(startSequence) || 1);
  return {
    attemptId,
    create(eventType, metadata = {}) {
      if (!isWebEventType(eventType)) throw new Error(`Unknown event type: ${eventType}`);
      return {
        eventType,
        source,
        occurredAt: now().toISOString(),
        clientSequence: seq++,
        metadata: sanitizeMetadata(metadata),
      };
    },
    peekSequence: () => seq,
  };
}

// Event contract validation (client severity/extra fields allowed nahi).
export function assertValidEvent(event) {
  const fail = (m) => { throw new Error(`Invalid event: ${m}`); };
  if (!event || typeof event !== 'object') fail('not an object');
  const allowed = ['eventType', 'source', 'occurredAt', 'clientSequence', 'metadata'];
  for (const k of Object.keys(event)) if (!allowed.includes(k)) fail(`unexpected field ${k}`);
  if (!isWebEventType(event.eventType)) fail('eventType');
  if (event.source !== 'WEB_CLIENT') fail('source');
  if (typeof event.occurredAt !== 'string' || !ISO_UTC.test(event.occurredAt)) fail('occurredAt');
  if (!Number.isInteger(event.clientSequence) || event.clientSequence < 1) fail('clientSequence');
  if (!event.metadata || typeof event.metadata !== 'object' || Array.isArray(event.metadata)) fail('metadata');
  if (byteLength(JSON.stringify(event.metadata)) > MAX_METADATA_BYTES) fail('metadata too large');
  return true;
}
