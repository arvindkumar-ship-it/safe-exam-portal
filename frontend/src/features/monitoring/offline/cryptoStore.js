import { openDb, reqP, txDone } from '../../../utils/idb.js';

// NOTE: browser-side key sirf deterrent hai (same-origin JS isse padh/use kar sakta hai).
let keyPromise = null;
export function __resetKeyCache() { keyPromise = null; } // sirf tests ke liye

const b64 = (bytes) => btoa(String.fromCharCode(...bytes));
const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

async function loadOrCreate() {
  let db = null;
  try {
    db = await openDb('safeexam-keys', 1, (d) => d.createObjectStore('keys'));
    const existing = await reqP(db.transaction('keys').objectStore('keys').get('answers-v1'));
    if (existing) return existing;
  } catch { /* IDB nahi: memory-only key */ }
  const key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  if (db) {
    try {
      const tx = db.transaction('keys', 'readwrite');
      tx.objectStore('keys').put(key, 'answers-v1');
      await txDone(tx);
    } catch { /* key persist nahi hui; session tak chalegi */ }
  }
  return key;
}

// AES-GCM 256, extractable:false
export function getOrCreateKey() {
  if (!keyPromise) keyPromise = loadOrCreate();
  return keyPromise;
}

// Random 12-byte IV per record. Blob = "<iv b64>.<ciphertext b64>"
export async function encryptJson(obj) {
  const key = await getOrCreateKey();
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(JSON.stringify(obj)));
  return `${b64(iv)}.${b64(new Uint8Array(data))}`;
}

export async function decryptJson(blob) {
  const key = await getOrCreateKey();
  const [ivB64, dataB64] = String(blob).split('.');
  const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(ivB64) }, key, unb64(dataB64));
  return JSON.parse(new TextDecoder().decode(plain));
}
