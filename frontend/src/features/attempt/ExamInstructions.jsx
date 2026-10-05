import { useState } from "react";
import Button from "../../components/Button";
import ConsentNotice from "../monitoring/ConsentNotice";
import { formatDuration } from "../../utils/formatting";

export default function ExamInstructions({ exam, onStart, busy = false }) {
  const [consent, setConsent] = useState(false);
  return (
    <section className="card">
      <h1>{exam.title}</h1>
      {exam.description && <p>{exam.description}</p>}
      <p>Duration: {formatDuration(exam.durationSeconds)}. The timer is controlled by the server and starts when you begin.</p>
      <ConsentNotice />
      <label>
        <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} /> I understand and agree to
        exam monitoring.
      </label>
      <div>
        <Button disabled={!consent || busy} onClick={() => onStart(consent)}>
          {busy ? "Starting…" : "Start exam"}
        </Button>
      </div>
    </section>
  );
}
