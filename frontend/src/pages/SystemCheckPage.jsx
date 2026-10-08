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
    <main className="system-check narrow">
      <h1>{practice ? 'Practice system check' : 'System readiness check'}</h1>
      <p aria-live="polite" className="lede">{running ? 'Checking your device…' : result ? (result.passed ? 'Your device is ready.' : 'Please fix the items marked FAIL.') : ''}</p>
      <ul className="check-list">
        {(result ? result.checks : []).map((c) => (
          <li key={c.id} data-status={c.status} className="check-item">
            <span className="badge">{c.status}</span>
            <span className="check-item__body"><span className="check-item__label">{c.label}</span>: <span className="check-item__msg">{c.message}</span></span>
          </li>
        ))}
      </ul>
      <div className="page-actions">
        <Link to="/" className="btn btn-ghost">Back</Link>
        <button type="button" className="btn btn-secondary" onClick={run} disabled={running}>Run again</button>
        {onContinue && <button type="button" className="btn btn-primary" disabled={!result || !result.passed} onClick={onContinue}>Continue</button>}
      </div>
    </main>
  );
}
