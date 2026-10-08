import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { attemptApi } from "../api/attemptApi";
import { examApi } from "../api/examApi";
import Button from "../components/Button";
import Icon from "../components/Icon";
import ErrorMessage from "../components/ErrorMessage";
import Loading from "../components/Loading";
import AppealForm from "../features/attempt/AppealForm";
import { formatDateTime, formatDuration } from "../utils/formatting";

const LIVE = ["ACTIVE", "UNDER_REVIEW"];

function ResultView({ attemptId }) {
  const [state, setState] = useState({ loading: false, result: null, error: null });
  async function load() {
    setState({ loading: true, result: null, error: null });
    try {
      setState({ loading: false, result: await attemptApi.getResult(attemptId), error: null });
    } catch (e) {
      setState({ loading: false, result: null, error: e });
    }
  }
  if (state.result)
    return <span>Score: {state.result.totalMarks} / {state.result.maxMarks}{state.result.passed != null && (state.result.passed ? " — passed" : " — not passed")}</span>;
  return (
    <>
      <Button variant="secondary" size="sm" onClick={load} disabled={state.loading}>View result</Button>
      <ErrorMessage error={state.error} />
    </>
  );
}

export default function StudentDashboard() {
  const [exams, setExams] = useState(null);
  const [attempts, setAttempts] = useState([]);
  const [error, setError] = useState(null);

  useEffect(() => {
    Promise.all([examApi.listExams({ pageSize: 50 }), attemptApi.mine()])
      .then(([e, a]) => { setExams(e.items); setAttempts(a); })
      .catch(setError);
  }, []);

  if (!exams && !error) return <main><Loading /></main>;
  return (
    <main>
      <div className="page-head">
        <div>
          <h1>My exams</h1>
          {exams && exams.length > 0 && <p>{exams.length} {exams.length === 1 ? "exam" : "exams"} available to you.</p>}
        </div>
      </div>
      <ErrorMessage error={error} />
      {exams?.length === 0 && (
        <div className="empty-state card">
          <span className="empty-state__icon"><Icon name="exam" size={20} /></span>
          <h3>No exams are available right now.</h3>
          <p>When an instructor publishes an exam for you, it will show up here.</p>
        </div>
      )}
      {exams?.length > 0 && (
        <div className="exam-list">
          {exams.map((e) => {
            const mine = attempts.filter((a) => a.examId === e.id);
            const live = mine.some((a) => LIVE.includes(a.status));
            const past = mine.filter((a) => !LIVE.includes(a.status));
            return (
              <section key={e.id} className="exam-item">
                <div className="exam-item__main">
                  <div>
                    <h2 className="exam-item__title">{e.title}</h2>
                    <p className="exam-item__meta">
                      <span>{formatDuration(e.durationSeconds)}</span>
                      <span>{formatDateTime(e.startsAt)} → {formatDateTime(e.endsAt)}</span>
                    </p>
                  </div>
                  {(live || mine.length < e.maxAttempts) && (
                    <Link to={`/exam/${e.id}`} className="btn btn-primary">{live ? "Resume exam" : "Start exam"}</Link>
                  )}
                </div>
                {past.length > 0 && (
                  <div className="attempts">
                    {past.map((a) => (
                      <div key={a.id} className="attempt-row">
                        <span className="badge">{a.status}</span> <span className="attempt-row__date">{formatDateTime(a.submittedAt)}</span>
                        <span className="attempt-row__result"><ResultView attemptId={a.id} /></span>
                        <details><summary>Appeal</summary><AppealForm attemptId={a.id} /></details>
                      </div>
                    ))}
                  </div>
                )}
              </section>
            );
          })}
        </div>
      )}
    </main>
  );
}
