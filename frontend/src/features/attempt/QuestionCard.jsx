import CodingPane from "./CodingPane.jsx";

export default function QuestionCard({ question, value, onChange, answerLabel = "Your answer", attemptId }) {
  const { id, type, prompt, options = [], marks } = question;
  const name = `q-${id}`;

  return (
    <fieldset className="card">
      <legend>{prompt} <small>({marks} {marks === 1 ? "mark" : "marks"})</small></legend>
      {type === "MCQ_SINGLE" &&
        options.map((o) => (
          <label key={o.id} className="field">
            <span><input type="radio" name={name} checked={value === o.id} onChange={() => onChange(o.id)} /> {o.text}</span>
          </label>
        ))}
      {type === "MCQ_MULTIPLE" &&
        options.map((o) => {
          const list = Array.isArray(value) ? value : [];
          return (
            <label key={o.id} className="field">
              <span>
                <input
                  type="checkbox" checked={list.includes(o.id)}
                  onChange={() => onChange(list.includes(o.id) ? list.filter((x) => x !== o.id) : [...list, o.id])}
                /> {o.text}
              </span>
            </label>
          );
        })}
      {type === "CODING" && <CodingPane question={question} attemptId={attemptId} value={value} onChange={onChange} />}
      {type === "SHORT_TEXT" && (
        <textarea aria-label={answerLabel} maxLength={2000} rows={4} value={value ?? ""} onChange={(e) => onChange(e.target.value)} />
      )}
    </fieldset>
  );
}
