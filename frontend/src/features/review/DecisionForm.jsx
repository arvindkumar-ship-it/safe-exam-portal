import { useState } from "react";
import { reviewApi } from "../../api/reviewApi";
import Button from "../../components/Button";
import ErrorMessage from "../../components/ErrorMessage";

const DECISIONS = ["NO_ISSUE", "NEEDS_CLARIFICATION", "POLICY_VIOLATION", "INVALID_FLAG"];

export default function DecisionForm({ attemptId, onSaved }) {
  const [decision, setDecision] = useState("NO_ISSUE");
  const [reason, setReason] = useState("");
  const [error, setError] = useState(null);
  const [localError, setLocalError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setError(null);
    if (reason.trim().length < 5) return setLocalError("Reason must be at least 5 characters.");
    setLocalError("");
    setBusy(true);
    try {
      await reviewApi.decide(attemptId, { decision, reason: reason.trim() });
      setReason("");
      onSaved?.();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="card form" aria-label="Decision form">
      <h3>Record decision</h3>
      <label>Decision
        <select value={decision} onChange={(e) => setDecision(e.target.value)}>
          {DECISIONS.map((d) => <option key={d}>{d}</option>)}
        </select>
      </label>
      <label>Reason<textarea value={reason} onChange={(e) => setReason(e.target.value)} /></label>
      {localError && <div role="alert" className="error-message">{localError}</div>}
      <ErrorMessage error={error} />
      <Button type="submit" disabled={busy} className="btn-block">{busy ? "Saving…" : "Record decision"}</Button>
      <small>Decisions are append-only and cannot be edited later.</small>
    </form>
  );
}
