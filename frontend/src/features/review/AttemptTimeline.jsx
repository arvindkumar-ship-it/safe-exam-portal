import { useCallback, useEffect, useState } from "react";
import { reviewApi } from "../../api/reviewApi";
import Button from "../../components/Button";
import Icon from "../../components/Icon";
import ErrorMessage from "../../components/ErrorMessage";
import Loading from "../../components/Loading";
import { formatDateTime } from "../../utils/formatting";
import { saveBlob } from "../../utils/download";
import DecisionForm from "./DecisionForm";

function AssignForm({ attemptId }) {
  const [reviewerId, setReviewerId] = useState("");
  const [msg, setMsg] = useState("");
  const [error, setError] = useState(null);
  async function submit(e) {
    e.preventDefault();
    setError(null);
    try {
      await reviewApi.assign(attemptId, reviewerId.trim());
      setMsg("Reviewer assigned.");
      setReviewerId("");
    } catch (err) {
      setMsg("");
      setError(err);
    }
  }
  return (
    <form onSubmit={submit} className="card form" aria-label="Assign reviewer">
      <label>Reviewer user ID<input value={reviewerId} onChange={(e) => setReviewerId(e.target.value)} /></label>
      <Button type="submit" variant="secondary" disabled={!reviewerId.trim()} className="btn-block">Assign reviewer</Button>
      {msg && <p role="status">{msg}</p>}
      <ErrorMessage error={error} />
    </form>
  );
}

export default function AttemptTimeline({ attemptId, canAssign = false, onBack }) {
  const [data, setData] = useState(null);
  const [chain, setChain] = useState(null);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    try {
      setError(null);
      const [t, c] = await Promise.all([reviewApi.timeline(attemptId), reviewApi.verifyChain(attemptId)]);
      setData(t);
      setChain(c);
    } catch (e) {
      setError(e);
    }
  }, [attemptId]);
  useEffect(() => { load(); }, [load]);

  async function exportAudit() {
    try {
      const report = await reviewApi.exportAudit(attemptId);
      saveBlob(new Blob([JSON.stringify(report, null, 2)], { type: "application/json" }), `audit-${attemptId}.json`);
    } catch (e) {
      setError(e);
    }
  }

  if (error && !data) return <><ErrorMessage error={error} /><Button variant="secondary" onClick={onBack}>Back</Button></>;
  if (!data) return <Loading />;

  return (
    <section>
      <div className="section-head">
        <Button variant="ghost" onClick={onBack}><Icon name="back" /> Back to queue</Button>
        <Button variant="secondary" onClick={exportAudit}><Icon name="download" /> Export audit report</Button>
      </div>
      <div className="page-head page-head--tight">
        <div>
          <h2 className="review-title">{data.attempt.studentName} — {data.attempt.examTitle}</h2>
          <p className="summary">
            Status <span className="badge">{data.attempt.status}</span>{" "}
            Risk <span className="badge badge-warn">{data.riskLevel} ({data.riskScore})</span>{" "}
            {chain && (
              <span className={`badge ${chain.valid ? "badge-ok" : "badge-bad"}`} data-testid="chain-badge">
                {chain.valid ? "Log chain verified" : `Log chain broken at ${chain.brokenAt}`}
              </span>
            )}
          </p>
        </div>
      </div>
      <p className="notice">The risk score is a review signal, not a verdict.</p>
      <ErrorMessage error={error} />

      <div className="split split--spaced">
        <div>
          <div className="review-section">
            <h3>Why this was flagged</h3>
            {data.reasons.length === 0 ? <p className="empty">No weighted events.</p> : <ul className="plain-list">{data.reasons.map((r) => <li key={r}>{r}</li>)}</ul>}
          </div>

          <div className="review-section">
            <h3>Events</h3>
            {data.events.length === 0 ? <p className="empty">No events recorded.</p> : (
              <ol aria-label="Event timeline" className="timeline">
                {data.events.map((e, i) => (
                  <li key={i}>
                    <span className="timeline__meta">{formatDateTime(e.occurredAt)}</span> — <strong className="timeline__type">{e.eventType}</strong> <span className="timeline__meta">({e.source}, {e.severity}, +{e.weight})</span>
                  </li>
                ))}
              </ol>
            )}
          </div>

          <div className="review-section">
            <h3>Decisions</h3>
            {data.decisions.length === 0 ? <p className="empty">No decisions yet.</p> : (
              <ul className="plain-list">
                {data.decisions.map((d) => (
                  <li key={d.id} className="decision">
                    <strong>{d.isAppeal ? "Appeal" : d.decision}</strong> by {d.reviewerName ?? "student"} — {d.reason}{" "}
                    <small>{formatDateTime(d.createdAt)}</small>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>

        <aside className="split__aside">
          <DecisionForm attemptId={attemptId} onSaved={load} />
          {canAssign && <AssignForm attemptId={attemptId} />}
        </aside>
      </div>
    </section>
  );
}
