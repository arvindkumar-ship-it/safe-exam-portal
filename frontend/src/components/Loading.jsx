export default function Loading({ label = "Loading…" }) {
  return (
    <div role="status" aria-live="polite" className="loading">
      {label}
    </div>
  );
}
