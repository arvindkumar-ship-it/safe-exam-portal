import { useCallback, useEffect, useState } from "react";
import { questionApi } from "../../api/questionApi";
import Button from "../../components/Button";
import ErrorMessage from "../../components/ErrorMessage";
import Loading from "../../components/Loading";
import Pagination from "../../components/Pagination";
import QuestionEditor from "./QuestionEditor";

const PAGE_SIZE = 10;

export default function QuestionBank() {
  const [data, setData] = useState(null);
  const [page, setPage] = useState(1);
  const [error, setError] = useState(null);
  const [editing, setEditing] = useState(undefined); // undefined=closed, null=new, obj=edit

  const load = useCallback(async () => {
    try {
      setError(null);
      setData(await questionApi.listQuestions({ page, pageSize: PAGE_SIZE }));
    } catch (e) {
      setError(e);
    }
  }, [page]);
  useEffect(() => { load(); }, [load]);

  async function deactivate(q) {
    try {
      await questionApi.deactivateQuestion(q.id);
      load();
    } catch (e) {
      setError(e);
    }
  }

  if (editing !== undefined)
    return <QuestionEditor question={editing} onCancel={() => setEditing(undefined)} onSaved={() => { setEditing(undefined); load(); }} />;

  return (
    <section>
      <div className="section-head">
        <h2>Question bank</h2>
        <Button onClick={() => setEditing(null)}>New question</Button>
      </div>
      <ErrorMessage error={error} />
      {!data && !error && <Loading />}
      {data && data.items.length === 0 && <p className="empty card">No questions yet.</p>}
      {data && data.items.length > 0 && (
        <>
          <div className="table-wrap">
          <table>
            <thead><tr><th>Type</th><th>Prompt</th><th className="num">Marks</th><th className="num">Actions</th></tr></thead>
            <tbody>
              {data.items.map((q) => (
                <tr key={q.id}>
                  <td><span className="badge">{q.questionType}</span></td><td className="cell-title">{q.prompt}</td><td className="num">{q.marks}</td>
                  <td>
                    <div className="row-actions">
                      <Button variant="ghost" size="sm" onClick={() => setEditing(q)}>Edit</Button>
                      <Button variant="danger" size="sm" onClick={() => deactivate(q)}>Deactivate</Button>
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
    </section>
  );
}
