import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { attemptApi } from "../api/attemptApi";
import { examApi } from "../api/examApi";
import Button from "../components/Button";
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
      <Button variant="secondary" onClick={load} disabled={state.loading}>View result</Button>
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
      <h1>My exams</h1>
      <ErrorMessage error={error} />
      {exams?.length === 0 && <p className="empty">No exams are available right now.</p>}
      {exams?.map((e) => {
        const mine = attempts.filter((a) => a.examId === e.id);
        const live = mine.some((a) => LIVE.includes(a.status));
        return (
          <section key={e.id} className="card">
            <h2>{e.title}</h2>
            <p>{formatDuration(e.durationSeconds)} · {formatDateTime(e.startsAt)} → {formatDateTime(e.endsAt)}</p>
            {(live || mine.length < e.maxAttempts) && (
              <Link to={`/exam/${e.id}`}>{live ? "Resume exam" : "Start exam"}</Link>
            )}
            {mine.filter((a) => !LIVE.includes(a.status)).map((a) => (
              <div key={a.id} className="form-row">
                <span className="badge">{a.status}</span> <span>{formatDateTime(a.submittedAt)}</span>
                <ResultView attemptId={a.id} />
                <details><summary>Appeal</summary><AppealForm attemptId={a.id} /></details>
              </div>
            ))}
          </section>
        );
      })}
    </main>
  );
}
