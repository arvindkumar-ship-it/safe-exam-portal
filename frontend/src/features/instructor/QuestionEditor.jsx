import { useState } from "react";
import { questionApi } from "../../api/questionApi";
import Button from "../../components/Button";
import ErrorMessage from "../../components/ErrorMessage";

const TYPES = ["MCQ_SINGLE", "MCQ_MULTIPLE", "SHORT_TEXT"];

function initial(q) {
  const type = q?.questionType ?? "MCQ_SINGLE";
  const options = q?.options ?? [{ id: "o1", text: "" }, { id: "o2", text: "" }];
  let correct = q?.correctAnswer ?? null;
  if (type === "MCQ_MULTIPLE") correct = Array.isArray(correct) ? correct : [];
  if (type === "SHORT_TEXT") correct = [].concat(correct ?? []).join("\n");
  return {
    type, prompt: q?.prompt ?? "", options, correct,
    marks: String(q?.marks ?? 1), negativeMarks: String(q?.negativeMarks ?? 0), explanation: q?.explanation ?? "",
  };
}

function nextId(options) {
  return `o${Math.max(0, ...options.map((o) => Number(o.id.slice(1)) || 0)) + 1}`;
}

export default function QuestionEditor({ question = null, onSaved, onCancel }) {
  const [f, setF] = useState(() => initial(question));
  const [error, setError] = useState(null);
  const [localError, setLocalError] = useState("");
  const [busy, setBusy] = useState(false);
  const isMcq = f.type !== "SHORT_TEXT";

  function changeType(type) {
    const fresh = initial({ questionType: type, prompt: f.prompt, marks: f.marks, negativeMarks: f.negativeMarks });
    setF({ ...fresh, type });
  }
  const setOption = (i, text) => setF({ ...f, options: f.options.map((o, j) => (j === i ? { ...o, text } : o)) });
  const addOption = () => setF({ ...f, options: [...f.options, { id: nextId(f.options), text: "" }] });
  const removeOption = (i) => {
    const gone = f.options[i].id;
    const correct = f.type === "MCQ_MULTIPLE" ? f.correct.filter((c) => c !== gone) : f.correct === gone ? null : f.correct;
    setF({ ...f, options: f.options.filter((_, j) => j !== i), correct });
  };
  const toggleCorrect = (id) => {
    if (f.type === "MCQ_SINGLE") return setF({ ...f, correct: id });
    setF({ ...f, correct: f.correct.includes(id) ? f.correct.filter((c) => c !== id) : [...f.correct, id] });
  };

  function buildBody() {
    const body = { prompt: f.prompt.trim(), marks: Number(f.marks), negativeMarks: Number(f.negativeMarks), explanation: f.explanation || null };
    if (isMcq) {
      body.options = f.options.map((o) => ({ id: o.id, text: o.text.trim() }));
      body.correctAnswer = f.correct;
    } else {
      const accepted = f.correct.split("\n").map((s) => s.trim()).filter(Boolean);
      body.options = null;
      body.correctAnswer = accepted.length === 0 ? null : accepted.length === 1 ? accepted[0] : accepted;
    }
    return body;
  }

  async function submit(e) {
    e.preventDefault();
    setError(null);
    setLocalError("");
    if (!f.prompt.trim()) return setLocalError("Prompt is required.");
    if (!(Number(f.marks) > 0)) return setLocalError("Marks must be more than 0.");
    if (isMcq && f.options.some((o) => !o.text.trim())) return setLocalError("Every option needs text.");
    if (isMcq && (Array.isArray(f.correct) ? f.correct.length === 0 : !f.correct)) return setLocalError("Pick the correct answer.");
    setBusy(true);
    try {
      const body = buildBody();
      const saved = question
        ? await questionApi.updateQuestion(question.id, body)
        : await questionApi.createQuestion({ questionType: f.type, ...body });
      onSaved?.(saved);
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="card form" aria-label="Question editor">
      <h3>{question ? "Edit question" : "New question"}</h3>
      <label>Type
        <select value={f.type} onChange={(e) => changeType(e.target.value)} disabled={!!question}>
          {TYPES.map((t) => <option key={t}>{t}</option>)}
        </select>
      </label>
      <label>Prompt<textarea value={f.prompt} onChange={(e) => setF({ ...f, prompt: e.target.value })} /></label>
      {isMcq ? (
        <fieldset>
          <legend>Options (tick the correct {f.type === "MCQ_SINGLE" ? "one" : "ones"})</legend>
          {f.options.map((o, i) => (
            <div key={o.id} className="form-row">
              <input
                type={f.type === "MCQ_SINGLE" ? "radio" : "checkbox"}
                name="correct" aria-label={`Correct: option ${i + 1}`}
                checked={f.type === "MCQ_SINGLE" ? f.correct === o.id : f.correct.includes(o.id)}
                onChange={() => toggleCorrect(o.id)}
              />
              <input aria-label={`Option ${i + 1}`} value={o.text} onChange={(e) => setOption(i, e.target.value)} />
              {f.options.length > 2 && <Button variant="secondary" onClick={() => removeOption(i)}>Remove</Button>}
            </div>
          ))}
          <Button variant="secondary" onClick={addOption}>Add option</Button>
        </fieldset>
      ) : (
        <label>Accepted answers (one per line; leave empty for manual review)
          <textarea value={f.correct} onChange={(e) => setF({ ...f, correct: e.target.value })} />
        </label>
      )}
      <div className="form-row">
        <label>Marks<input type="number" step="0.01" value={f.marks} onChange={(e) => setF({ ...f, marks: e.target.value })} /></label>
        <label>Negative marks<input type="number" step="0.01" value={f.negativeMarks} onChange={(e) => setF({ ...f, negativeMarks: e.target.value })} /></label>
      </div>
      <label>Explanation (hidden during exam)<textarea value={f.explanation} onChange={(e) => setF({ ...f, explanation: e.target.value })} /></label>
      {localError && <div role="alert" className="error-message">{localError}</div>}
      <ErrorMessage error={error} />
      <div className="form-row">
        <Button type="submit" disabled={busy}>{busy ? "Saving…" : "Save question"}</Button>
        {onCancel && <Button variant="secondary" onClick={onCancel}>Cancel</Button>}
      </div>
    </form>
  );
}
