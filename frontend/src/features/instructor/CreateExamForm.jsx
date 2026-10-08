import { useState } from "react";
import { examApi } from "../../api/examApi";
import Button from "../../components/Button";
import ErrorMessage from "../../components/ErrorMessage";
import { fromLocalInput, toLocalInput } from "../../utils/formatting";

function initial(exam) {
  return {
    title: exam?.title ?? "",
    description: exam?.description ?? "",
    durationMinutes: exam ? String(Math.round(exam.durationSeconds / 60)) : "60",
    startsAt: toLocalInput(exam?.startsAt),
    endsAt: toLocalInput(exam?.endsAt),
    maxAttempts: String(exam?.maxAttempts ?? 1),
    passMarks: exam?.passMarks ?? "",
    showResult: exam?.showResult ?? false,
    shuffleQuestions: exam?.shuffleQuestions ?? true,
    shuffleOptions: exam?.shuffleOptions ?? true,
    lockOnHighRisk: exam?.lockOnHighRisk ?? false,
    monitoringPolicy: JSON.stringify(exam?.monitoringPolicy ?? {}, null, 2),
    strict: exam?.monitoringPolicy?.autoSubmitOnViolation === true,
  };
}

function validate(f) {
  const errors = {};
  if (!f.title.trim()) errors.title = "Title is required.";
  if (!(Number(f.durationMinutes) > 0)) errors.durationMinutes = "Duration must be more than 0.";
  if (f.startsAt && f.endsAt && new Date(f.endsAt) <= new Date(f.startsAt)) errors.endsAt = "End must be after start.";
  if (!(Number(f.maxAttempts) >= 1)) errors.maxAttempts = "At least 1 attempt.";
  try {
    const p = JSON.parse(f.monitoringPolicy || "{}");
    if (p === null || typeof p !== "object" || Array.isArray(p)) throw new Error();
  } catch {
    errors.monitoringPolicy = "Monitoring policy must be a JSON object.";
  }
  return errors;
}

// exam null => create; exam diya => edit (non-DRAFT me restricted fields read-only)
export default function CreateExamForm({ exam = null, onSaved, onCancel }) {
  const [f, setF] = useState(() => initial(exam));
  const [errors, setErrors] = useState({});
  const [apiError, setApiError] = useState(null);
  const [busy, setBusy] = useState(false);
  const locked = !!exam && exam.status !== "DRAFT";

  const set = (k) => (e) => setF({ ...f, [k]: e.target.type === "checkbox" ? e.target.checked : e.target.value });

  async function submit(e) {
    e.preventDefault();
    setApiError(null);
    const v = validate(f);
    setErrors(v);
    if (Object.keys(v).length) return;

    const body = {
      title: f.title.trim(),
      description: f.description || null,
      maxAttempts: Number(f.maxAttempts),
      passMarks: f.passMarks === "" ? null : Number(f.passMarks),
      showResult: f.showResult,
      lockOnHighRisk: f.lockOnHighRisk,
    };
    if (!locked) {
      Object.assign(body, {
        durationSeconds: Math.round(Number(f.durationMinutes) * 60),
        startsAt: fromLocalInput(f.startsAt),
        endsAt: fromLocalInput(f.endsAt),
        shuffleQuestions: f.shuffleQuestions,
        shuffleOptions: f.shuffleOptions,
        monitoringPolicy: { ...JSON.parse(f.monitoringPolicy || "{}"), autoSubmitOnViolation: f.strict },
      });
    }
    setBusy(true);
    try {
      const saved = exam ? await examApi.updateExam(exam.id, body) : await examApi.createExam(body);
      onSaved?.(saved);
    } catch (err) {
      setApiError(err); // form state same rehta hai
    } finally {
      setBusy(false);
    }
  }

  const fieldError = (k) => errors[k] && <span role="alert" className="field-error">{errors[k]}</span>;

  return (
    <form onSubmit={submit} className="card form form-card" aria-label={exam ? "Edit exam" : "Create exam"}>
      <h2>{exam ? "Edit exam" : "Create exam"}</h2>
      {locked && <p className="notice">This exam is {exam.status.toLowerCase()}; timing, shuffle and monitoring fields are read-only.</p>}
      <label>Title<input value={f.title} onChange={set("title")} />{fieldError("title")}</label>
      <label>Description<textarea value={f.description} onChange={set("description")} /></label>

      <div className="form-section">
        <div className="form-section__title">Schedule</div>
        <div className="grid-3">
          <label>Duration (minutes)<input type="number" value={f.durationMinutes} onChange={set("durationMinutes")} disabled={locked} />{fieldError("durationMinutes")}</label>
          <label>Starts at<input type="datetime-local" value={f.startsAt} onChange={set("startsAt")} disabled={locked} /></label>
          <label>Ends at<input type="datetime-local" value={f.endsAt} onChange={set("endsAt")} disabled={locked} />{fieldError("endsAt")}</label>
        </div>
      </div>

      <div className="form-section">
        <div className="form-section__title">Attempts and results</div>
        <div className="grid-2">
          <label>Max attempts<input type="number" value={f.maxAttempts} onChange={set("maxAttempts")} />{fieldError("maxAttempts")}</label>
          <label>Pass marks<input type="number" step="0.01" value={f.passMarks} onChange={set("passMarks")} /></label>
        </div>
        <div className="grid-2">
          <label className="check"><input type="checkbox" checked={f.showResult} onChange={set("showResult")} /> Show result to students</label>
          <label className="check"><input type="checkbox" checked={f.shuffleQuestions} onChange={set("shuffleQuestions")} disabled={locked} /> Shuffle questions</label>
          <label className="check"><input type="checkbox" checked={f.shuffleOptions} onChange={set("shuffleOptions")} disabled={locked} /> Shuffle options</label>
        </div>
      </div>

      <div className="form-section">
        <div className="form-section__title">Proctoring</div>
        <label className="check"><input type="checkbox" checked={f.lockOnHighRisk} onChange={set("lockOnHighRisk")} /> Lock attempt for review on high risk</label>
        <label className="check"><input type="checkbox" checked={f.strict} onChange={set("strict")} disabled={locked} /> Strict proctoring: auto-submit on tab switch, window switch or fullscreen exit</label>
        <label>Monitoring policy (JSON)<textarea className="mono" rows={4} value={f.monitoringPolicy} onChange={set("monitoringPolicy")} disabled={locked} />{fieldError("monitoringPolicy")}</label>
      </div>

      <ErrorMessage error={apiError} />
      <div className="form-actions">
        {onCancel && <Button variant="secondary" onClick={onCancel}>Cancel</Button>}
        <Button type="submit" disabled={busy}>{busy ? "Saving…" : "Save"}</Button>
      </div>
    </form>
  );
}
