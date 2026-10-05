import { useEffect, useState } from "react";
import { useTimer } from "../../hooks/useTimer";
import { formatClock } from "../../utils/formatting";

// Screen reader ko har second nahi, sirf minute badalne par / last 60s ke milestones par bolo.
function spoken(s) {
  if (s <= 0) return "Time is up";
  if (s <= 60 && [60, 30, 10].includes(s)) return `${s} seconds remaining`;
  if (s > 60 && s % 60 === 0) return `${s / 60} minutes remaining`;
  return null;
}

export default function ExamTimer({ expiresAt, serverTime, onExpire }) {
  const { remainingSeconds } = useTimer({ expiresAt, serverTime, onExpire });
  const [announce, setAnnounce] = useState("");
  useEffect(() => {
    const m = spoken(remainingSeconds);
    if (m) setAnnounce(m);
  }, [remainingSeconds]);

  const warn = remainingSeconds <= 60;
  return (
    <div>
      <span className={warn ? "timer timer-warn" : "timer"} data-testid="timer">{formatClock(remainingSeconds)}</span>
      <span className="sr-only" aria-live="polite">{announce}</span>
    </div>
  );
}
