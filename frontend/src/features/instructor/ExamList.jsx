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
const STATUS_TONE = { DRAFT: "", PUBLISHED: "badge-info", ACTIVE: "badge-ok", CLOSED: "badge-warn", ARCHIVED: "" };
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
      <div className="section-head">
        <h2>Exams</h2>
        <div className="row">
          <label className="field field-inline">Status
            <select value={status} onChange={(e) => { setPage(1); setStatus(e.target.value); }}>
              {STATUSES.map((s) => <option key={s} value={s}>{s || "All"}</option>)}
            </select>
          </label>
          <Button onClick={() => setPanel({ kind: "form", exam: null })}>Create exam</Button>
        </div>
      </div>
      <ErrorMessage error={error} />
      {problems.length > 0 && (
        <div role="alert" className="warning">
          <strong>Fix these before publishing:</strong>
          <ul>{problems.map((p) => <li key={p}>{p}</li>)}</ul>
        </div>
      )}
      {!data && !error && <Loading />}
      {data && data.items.length === 0 && <p className="empty card">No exams yet. Create your first exam.</p>}
      {data && data.items.length > 0 && (
        <>
          <div className="table-wrap">
          <table>
            <thead><tr><th>Title</th><th>Status</th><th>Duration</th><th>Window</th><th className="num">Actions</th></tr></thead>
            <tbody>
              {data.items.map((e) => (
                <tr key={e.id}>
                  <td className="cell-title exam-title-cell">{e.title}</td>
                  <td><span className={`badge badge--dot ${STATUS_TONE[e.status] || ""}`}>{e.status}</span></td>
                  <td>{formatDuration(e.durationSeconds)}</td>
                  <td>{formatDateTime(e.startsAt)} → {formatDateTime(e.endsAt)}</td>
                  <td>
                    <div className="row-actions">
                      <Button variant="ghost" size="sm" onClick={() => setPanel({ kind: "form", exam: e })}>Edit</Button>
                      <Button variant="ghost" size="sm" onClick={() => setPanel({ kind: "questions", exam: e })}>Questions</Button>
                      {e.status !== "DRAFT" && <Button variant="ghost" size="sm" onClick={() => setPanel({ kind: "results", exam: e })}>Results</Button>}
                      {NEXT[e.status] && <Button variant="secondary" size="sm" onClick={() => act(() => examApi.setStatus(e.id, NEXT[e.status]))}>Move to {NEXT[e.status]}</Button>}
                      {e.status === "DRAFT" && <Button size="sm" onClick={() => act(() => examApi.publishExam(e.id))}>Publish</Button>}
                      {e.status === "DRAFT" && <Button variant="danger" size="sm" onClick={() => act(() => examApi.deleteExam(e.id))}>Delete</Button>}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
          <Pagination page={data.page} pageSize={data.pageSize} total={data.total} onPage={setPage} />
        </>
      )}
      {panel?.kind === "questions" && <ExamQuestionPicker exam={panel.exam} onClose={() => setPanel(null)} />}
      {panel?.kind === "results" && <ResultsPanel exam={panel.exam} onClose={() => setPanel(null)} />}
    </section>
  );
}
