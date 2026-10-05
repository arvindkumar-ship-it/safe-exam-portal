import { useState } from "react";
import { reviewApi } from "../../api/reviewApi";
import Button from "../../components/Button";
import ErrorMessage from "../../components/ErrorMessage";

export default function AppealForm({ attemptId }) {
  const [reason, setReason] = useState("");
  const [sent, setSent] = useState(false);
  const [error, setError] = useState(null);
  const [localError, setLocalError] = useState("");

  async function submit(e) {
    e.preventDefault();
    setError(null);
    if (reason.trim().length < 5) return setLocalError("Please explain in at least 5 characters.");
    setLocalError("");
    try {
      await reviewApi.appeal(attemptId, reason.trim());
      setSent(true);
    } catch (err) {
      setError(err);
    }
  }

  if (sent) return <p role="status">Your appeal was sent to the instructor.</p>;
  return (
    <form onSubmit={submit} className="form" aria-label="Appeal form">
      <label>Appeal reason<textarea value={reason} onChange={(e) => setReason(e.target.value)} /></label>
      {localError && <div role="alert" className="error-message">{localError}</div>}
      <ErrorMessage error={error} />
      <Button type="submit">Send appeal</Button>
    </form>
  );
}
