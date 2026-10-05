// Access token badalne par subscribers ko batata hai (B native binding ke liye).
const listeners = new Set();

export function onAccessTokenChange(cb) {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

export function emitAccessToken(token) {
  listeners.forEach((cb) => {
    try {
      cb(token);
    } catch {
      /* ek subscriber doosron ko na roke */
    }
  });
}
