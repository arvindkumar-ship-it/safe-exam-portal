import { useCallback, useEffect, useState } from "react";
import { examApi } from "../../api/examApi";
import { questionApi } from "../../api/questionApi";
import Button from "../../components/Button";
import ErrorMessage from "../../components/ErrorMessage";
import Loading from "../../components/Loading";

export default function ExamQuestionPicker({ exam, onClose }) {
  const [attached, setAttached] = useState(null);
  const [bank, setBank] = useState([]);
  const [error, setError] = useState(null);
  const editable = exam.status === "DRAFT";

  const load = useCallback(async () => {
    try {
      setError(null);
      const [a, b] = await Promise.all([examApi.listExamQuestions(exam.id), questionApi.listQuestions({ pageSize: 100 })]);
      setAttached(a);
      setBank(b.items);
    } catch (e) {
      setError(e);
    }
  }, [exam.id]);
  useEffect(() => { load(); }, [load]);

  async function run(fn) {
    try {
      setError(null);
      await fn();
      await load();
    } catch (e) {
      setError(e);
    }
  }

  const move = (i, d) => {
    const ids = attached.map((a) => a.questionId);
    [ids[i], ids[i + d]] = [ids[i + d], ids[i]];
    return run(() => examApi.reorderQuestions(exam.id, ids));
  };

  if (!attached && !error) return <Loading />;
  const attachedIds = new Set((attached ?? []).map((a) => a.questionId));
  const available = bank.filter((q) => !attachedIds.has(q.id));

  return (
    <section className="card">
      <div className="form-row"><h3>Questions in “{exam.title}”</h3><Button variant="secondary" onClick={onClose}>Close</Button></div>
      {!editable && <p className="notice">Questions can only be changed while the exam is a draft.</p>}
      <ErrorMessage error={error} />
      {attached?.length === 0 && <p className="empty">No questions attached.</p>}
      <ol>
        {(attached ?? []).map((a, i) => (
          <li key={a.questionId}>
            {a.question.prompt} <span className="badge">{a.marks} marks</span>{" "}
            {editable && (
              <>
                <Button variant="secondary" disabled={i === 0} onClick={() => move(i, -1)} aria-label={`Move up ${a.question.prompt}`}>↑</Button>{" "}
                <Button variant="secondary" disabled={i === attached.length - 1} onClick={() => move(i, 1)} aria-label={`Move down ${a.question.prompt}`}>↓</Button>{" "}
                <Button variant="danger" onClick={() => run(() => examApi.detachQuestion(exam.id, a.questionId))}>Detach</Button>
              </>
            )}
          </li>
        ))}
      </ol>
      {editable && (
        <>
          <h4>Add from question bank</h4>
          {available.length === 0 && <p className="empty">No more questions available.</p>}
          <ul>
            {available.map((q) => (
              <li key={q.id}>{q.prompt} <Button variant="secondary" onClick={() => run(() => examApi.attachQuestion(exam.id, { questionId: q.id }))}>Attach</Button></li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
