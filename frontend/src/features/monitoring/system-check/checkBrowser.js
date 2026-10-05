import { getBrowserSupport } from '../../../utils/browserSupport.js';
import { openDb } from '../../../utils/idb.js';

export function checkBrowser(opts) {
  const s = getBrowserSupport(opts);
  const hardMissing = s.missing.filter((m) => m !== 'Fullscreen API');
  if (!s.supported) {
    return { id: 'browser', label: 'Browser support', status: 'FAIL',
      message: `Your browser is missing: ${hardMissing.join(', ')}. Please use the latest Chrome, Edge, Firefox or Safari over HTTPS.` };
  }
  return { id: 'browser', label: 'Browser support', status: 'PASS', message: `${s.browser.name} ${s.browser.version} is supported.` };
}

// IndexedDB open test (private mode / disabled storage pakadne ke liye).
export async function checkStorage() {
  const base = { id: 'storage', label: 'Local storage' };
  try {
    const name = '__safeexam_check__';
    const db = await openDb(name, 1, (d) => d.createObjectStore('t'));
    db.close();
    indexedDB.deleteDatabase(name);
    return { ...base, status: 'PASS', message: 'Local storage is available.' };
  } catch {
    return { ...base, status: 'FAIL', message: 'Local storage is blocked. Turn off private browsing or allow site storage, then try again.' };
  }
}
