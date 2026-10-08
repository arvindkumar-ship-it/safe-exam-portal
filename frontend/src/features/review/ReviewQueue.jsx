import { useEffect, useState } from "react";
import { reviewApi } from "../../api/reviewApi";
import Button from "../../components/Button";
import ErrorMessage from "../../components/ErrorMessage";
import Loading from "../../components/Loading";
import Pagination from "../../components/Pagination";
import { formatDateTime } from "../../utils/formatting";

const LEVELS = ["", "NORMAL", "WARNING", "REVIEW_REQUIRED", "HIGH_RISK"];
const STATUSES = ["", "ACTIVE", "UNDER_REVIEW", "SUBMITTED", "AUTO_SUBMITTED", "TERMINATED"];
const PAGE_SIZE = 10;

export default function ReviewQueue({ onSelect }) {
  const [filters, setFilters] = useState({ riskLevel: "", status: "", examId: "" });
  const [page, setPage] = useState(1);
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    let live = true;
    setError(null);
    reviewApi.queue({ ...filters, page, pageSize: PAGE_SIZE })
      .then((d) => live && setData(d))
      .catch((e) => live && setError(e));
    return () => { live = false; };
  }, [filters, page]);

  const set = (k) => (e) => { setPage(1); setFilters({ ...filters, [k]: e.target.value }); };

  return (
    <section>
      <div className="section-head"><h2>Review queue</h2></div>
      <div className="toolbar">
        <label className="field">Risk level
          <select value={filters.riskLevel} onChange={set("riskLevel")}>
            {LEVELS.map((l) => <option key={l} value={l}>{l || "All"}</option>)}
          </select>
        </label>
        <label className="field">Status
          <select value={filters.status} onChange={set("status")}>
            {STATUSES.map((s) => <option key={s} value={s}>{s || "All"}</option>)}
          </select>
        </label>
        <label className="field">Exam ID<input value={filters.examId} onChange={set("examId")} /></label>
      </div>
      <ErrorMessage error={error} />
      {!data && !error && <Loading />}
      {data?.items.length === 0 && <p className="empty card">Nothing to review.</p>}
      {data?.items.length > 0 && (
        <>
          <div className="table-wrap">
          <table>
            <thead><tr><th>Student</th><th>Exam</th><th>Status</th><th>Risk</th><th>Last event</th><th /></tr></thead>
            <tbody>
              {data.items.map((a) => (
                <tr key={a.attemptId}>
                  <td className="cell-title">{a.studentName}</td><td>{a.examTitle}</td><td><span className="badge">{a.status}</span></td>
                  <td><span className={`badge ${a.riskLevel === "HIGH_RISK" ? "badge-bad" : a.riskLevel === "NORMAL" ? "badge-ok" : "badge-warn"}`}>{a.riskLevel}</span></td>
                  <td>{formatDateTime(a.lastEventAt)}</td>
                  <td><div className="row-actions"><Button variant="secondary" size="sm" onClick={() => onSelect(a.attemptId)}>Open</Button></div></td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
          <Pagination page={data.page} pageSize={data.pageSize} total={data.total} onPage={setPage} />
        </>
      )}
    </section>
  );
}
