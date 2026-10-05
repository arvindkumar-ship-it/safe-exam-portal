import { useCallback, useEffect, useState } from "react";
import { examApi } from "../../api/examApi";
import Button from "../../components/Button";
import ErrorMessage from "../../components/ErrorMessage";
import Loading from "../../components/Loading";
import { saveBlob } from "../../utils/download";

export default function ResultsPanel({ exam, onClose }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    try {
      setError(null);
      setData(await examApi.listResults(exam.id));
    } catch (e) {
      setError(e);
    }
  }, [exam.id]);
  useEffect(() => { load(); }, [load]);

  async function publish() {
    try { await examApi.publishResults(exam.id); load(); } catch (e) { setError(e); }
  }
  async function download() {
    try { saveBlob(await examApi.downloadResultsCsv(exam.id), `results-${exam.id}.csv`); } catch (e) { setError(e); }
  }

  return (
    <section className="card">
      <div className="form-row">
        <h3>Results — {exam.title}</h3>
        <Button onClick={publish}>Publish results</Button>
        <Button variant="secondary" onClick={download}>Download CSV</Button>
        <Button variant="secondary" onClick={onClose}>Close</Button>
      </div>
      <ErrorMessage error={error} />
      {!data && !error && <Loading />}
      {data?.items.length === 0 && <p className="empty">No attempts yet.</p>}
      {data?.items.length > 0 && (
        <table>
          <thead><tr><th>Student</th><th>Status</th><th>Marks</th><th>Passed</th><th>Risk</th><th>Published</th></tr></thead>
          <tbody>
            {data.items.map((r) => (
              <tr key={r.attemptId}>
                <td>{r.studentName}<br /><small>{r.studentEmail}</small></td>
                <td>{r.attemptStatus}</td>
                <td>{r.totalMarks == null ? "—" : `${r.totalMarks} / ${r.maxMarks}`}</td>
                <td>{r.passed == null ? "—" : r.passed ? "Yes" : "No"}</td>
                <td>{r.riskLevel}</td>
                <td>{r.published ? "Yes" : "No"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
