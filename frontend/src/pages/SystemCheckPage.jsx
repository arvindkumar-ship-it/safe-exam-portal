import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { runSystemCheck } from '../features/monitoring/system-check/systemCheckService.js';

// Exam se pehle ya practice mode me same page.
export default function SystemCheckPage({ policy, onContinue, practice = false }) {
  const [result, setResult] = useState(null);
  const [running, setRunning] = useState(false);

  const run = useCallback(async () => {
    setRunning(true);
    try { setResult(await runSystemCheck({ policy })); } finally { setRunning(false); }
  }, [policy]);

  useEffect(() => { run(); }, [run]);

  return (
    <main className="system-check">
      <h1>{practice ? 'Practice system check' : 'System readiness check'}</h1>
      <p aria-live="polite">{running ? 'Checking your device…' : result ? (result.passed ? 'Your device is ready.' : 'Please fix the items marked FAIL.') : ''}</p>
      <ul>
        {(result ? result.checks : []).map((c) => (
          <li key={c.id} data-status={c.status}>
            <strong>{c.status}</strong> — {c.label}: {c.message}
          </li>
        ))}
      </ul>
      <button type="button" className="btn btn-secondary" onClick={run} disabled={running}>Run again</button>
      {' '}<Link to="/">Back</Link>
      {onContinue && <button type="button" className="primary" disabled={!result || !result.passed} onClick={onContinue}>Continue</button>}
    </main>
  );
}
