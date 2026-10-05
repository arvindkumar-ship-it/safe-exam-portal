import { useEffect, useRef, useState } from 'react';

// remaining har tick expiresAt - serverNow se nikalta hai (decrement nahi), isliye
// throttled/background tab me bhi sahi rehta hai. Zero par sirf onExpire() — final decision backend.
export function useTimer({ expiresAt, serverTime, onExpire, offsetMs } = {}) {
  const initialOffset = useRef(null);
  if (initialOffset.current === null) {
    const t = serverTime ? Date.parse(serverTime) : NaN;
    initialOffset.current = Number.isNaN(t) ? 0 : t - Date.now();
  }
  const offset = typeof offsetMs === 'number' ? offsetMs : initialOffset.current;
  const expiresMs = Date.parse(expiresAt);

  const compute = () => {
    if (Number.isNaN(expiresMs)) return 0;
    return Math.max(0, Math.ceil((expiresMs - (Date.now() + offset)) / 1000));
  };

  const [remainingSeconds, setRemaining] = useState(compute);
  const firedRef = useRef(false);
  const onExpireRef = useRef(onExpire);
  onExpireRef.current = onExpire;

  useEffect(() => {
    const tick = () => {
      const r = compute();
      setRemaining(r);
      if (r > 0) firedRef.current = false;
      else if (!firedRef.current) { firedRef.current = true; if (onExpireRef.current) onExpireRef.current(); }
    };
    tick();
    const id = setInterval(tick, 500);
    const onVis = () => { if (document.visibilityState !== 'hidden') tick(); };
    document.addEventListener('visibilitychange', onVis);
    return () => { clearInterval(id); document.removeEventListener('visibilitychange', onVis); };
  }, [expiresMs, offset]); // eslint-disable-line

  return { remainingSeconds, isExpired: remainingSeconds <= 0 };
}
