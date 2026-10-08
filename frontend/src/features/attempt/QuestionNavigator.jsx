export function isAnswered(value) {
  if (value === undefined || value === null) return false;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === "object") return String(value.source ?? "").trim() !== "";   // CODING draft
  return String(value).trim() !== "";
}

export default function QuestionNavigator({ questions, answers, currentIndex, onSelect }) {
  return (
    <nav aria-label="Question navigator" className="nav-grid">
      {questions.map((q, i) => (
        <button
          key={q.id} type="button"
          className={`nav-btn${isAnswered(answers[q.id]) ? " answered" : ""}`}
          aria-current={i === currentIndex ? "true" : undefined}
          aria-label={`Question ${i + 1}${isAnswered(answers[q.id]) ? ", answered" : ""}`}
          onClick={() => onSelect(i)}
        >
          {i + 1}
        </button>
      ))}
    </nav>
  );
}
