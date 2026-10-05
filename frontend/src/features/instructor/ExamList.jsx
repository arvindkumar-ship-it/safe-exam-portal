import { useCallback, useEffect, useState } from "react";
import { examApi } from "../../api/examApi";
import Button from "../../components/Button";
import ErrorMessage from "../../components/ErrorMessage";
import Loading from "../../components/Loading";
import Pagination from "../../components/Pagination";
import { formatDateTime, formatDuration } from "../../utils/formatting";
import CreateExamForm from "./CreateExamForm";
import ExamQuestionPicker from "./ExamQuestionPicker";
import ResultsPanel from "./ResultsPanel";

const PAGE_SIZE = 10;
const STATUSES = ["", "DRAFT", "PUBLISHED", "ACTIVE", "CLOSED", "ARCHIVED"];
const NEXT = { PUBLISHED: "ACTIVE", ACTIVE: "CLOSED", CLOSED: "ARCHIVED" };

export default function ExamList() {
  const [data, setData] = useState(null);
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState("");
  const [error, setError] = useState(null);
  const [problems, setProblems] = useState([]);
  const [panel, setPanel] = useState(null); // {kind:"form"|"questions"|"results", exam}

  const load = useCallback(async () => {
    try {
      setError(null);
      setData(await examApi.listExams({ page, pageSize: PAGE_SIZE, status }));
    } catch (e) {
      setError(e);
    }
  }, [page, status]);
  useEffect(() => { load(); }, [load]);

  async function act(fn) {
    setError(null);
    setProblems([]);
    try {
      await fn();
      await load();
    } catch (e) {
      setProblems(e.details?.problems ?? []); // publish fail par problem list
      setError(e);
    }
  }

  if (panel?.kind === "form")
    return <CreateExamForm exam={panel.exam} onCancel={() => setPanel(null)} onSaved={() => { setPanel(null); load(); }} />;

  return (
    <section>
      <div className="form-row">
        <h2>Exams</h2>
        <Button onClick={() => setPanel({ kind: "form", exam: null })}>Create exam</Button>
        <label className="field">Status
          <select value={status} onChange={(e) => { setPage(1); setStatus(e.target.value); }}>
            {STATUSES.map((s) => <option key={s} value={s}>{s || "All"}</option>)}
          </select>
        </label>
      </div>
      <ErrorMessage error={error} />
      {problems.length > 0 && (
        <div role="alert" className="warning">
          <strong>Fix these before publishing:</strong>
          <ul>{problems.map((p) => <li key={p}>{p}</li>)}</ul>
        </div>
      )}
      {!data && !error && <Loading />}
      {data && data.items.length === 0 && <p className="empty">No exams yet. Create your first exam.</p>}
      {data && data.items.length > 0 && (
        <>
          <table>
            <thead><tr><th>Title</th><th>Status</th><th>Duration</th><th>Window</th><th>Actions</th></tr></thead>
            <tbody>
              {data.items.map((e) => (
                <tr key={e.id}>
                  <td>{e.title}</td>
                  <td><span className="badge">{e.status}</span></td>
                  <td>{formatDuration(e.durationSeconds)}</td>
                  <td>{formatDateTime(e.startsAt)} → {formatDateTime(e.endsAt)}</td>
                  <td className="form-row">
                    <Button variant="secondary" onClick={() => setPanel({ kind: "form", exam: e })}>Edit</Button>
                    <Button variant="secondary" onClick={() => setPanel({ kind: "questions", exam: e })}>Questions</Button>
                    {e.status === "DRAFT" && <Button onClick={() => act(() => examApi.publishExam(e.id))}>Publish</Button>}
                    {e.status === "DRAFT" && <Button variant="danger" onClick={() => act(() => examApi.deleteExam(e.id))}>Delete</Button>}
                    {NEXT[e.status] && <Button variant="secondary" onClick={() => act(() => examApi.setStatus(e.id, NEXT[e.status]))}>Move to {NEXT[e.status]}</Button>}
                    {e.status !== "DRAFT" && <Button variant="secondary" onClick={() => setPanel({ kind: "results", exam: e })}>Results</Button>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <Pagination page={data.page} pageSize={data.pageSize} total={data.total} onPage={setPage} />
        </>
      )}
      {panel?.kind === "questions" && <ExamQuestionPicker exam={panel.exam} onClose={() => setPanel(null)} />}
      {panel?.kind === "results" && <ResultsPanel exam={panel.exam} onClose={() => setPanel(null)} />}
    </section>
  );
}
