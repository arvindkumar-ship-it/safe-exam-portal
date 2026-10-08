import { useEffect, useRef, useState } from 'react';
import { useExamMonitoring } from './useExamMonitoring.js';

const THROTTLE_MS = 10000;
const AUTOHIDE_MS = 8000;

// Student warning. Repeat warnings >=10s gap par; risk/score ka zikr kabhi nahi.
export default function WarningToast() {
  const { lastWarning, lastWarningType, warningSeq, eventCount, enterFullscreen, status } = useExamMonitoring();
  const [visible, setVisible] = useState(false);
  const lastShownAt = useRef(-Infinity);
  const lastSeq = useRef(0);

  useEffect(() => {
    if (!warningSeq || warningSeq === lastSeq.current) return undefined;
    lastSeq.current = warningSeq;
    const now = Date.now();
    if (now - lastShownAt.current < THROTTLE_MS) return undefined; // throttle
    lastShownAt.current = now;
    setVisible(true);
    const id = setTimeout(() => setVisible(false), AUTOHIDE_MS);
    return () => clearTimeout(id);
  }, [warningSeq]);

  if (!visible || !lastWarning) return null;
  return (
    <div className="warning-toast" role="alert">
      <p>{lastWarning}</p>
      <p className="warning-toast__count">{eventCount} {eventCount === 1 ? 'event' : 'events'} recorded</p>
      <div className="warning-toast__actions">
        {lastWarningType === 'FULLSCREEN_EXIT' && !status.fullscreen && (
          <button type="button" className="btn btn-primary btn-sm" onClick={() => enterFullscreen()}>Re-enter fullscreen</button>
        )}
        <button type="button" className="btn btn-secondary btn-sm" onClick={() => setVisible(false)} aria-label="Dismiss warning">Dismiss</button>
      </div>
    </div>
  );
}
