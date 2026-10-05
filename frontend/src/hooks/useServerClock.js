import { useCallback, useState } from 'react';

const offsetFrom = (serverTime) => {
  const t = Date.parse(serverTime);
  return Number.isNaN(t) ? null : t - Date.now();
};

// offsetMs = serverNow - clientNow. Heartbeat se baar-baar sync hota hai.
export function useServerClock({ initialServerTime } = {}) {
  const [offsetMs, setOffset] = useState(() => (initialServerTime ? offsetFrom(initialServerTime) ?? 0 : 0));
  const sync = useCallback((serverTime) => {
    const o = offsetFrom(serverTime);
    if (o !== null) setOffset(o);
  }, []);
  return { offsetMs, sync };
}
