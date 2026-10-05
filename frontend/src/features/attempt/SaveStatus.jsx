const TEXT = {
  IDLE: "",
  SAVING: "Saving…",
  SAVED: "All answers saved",
  FAILED: "Could not save — retrying is available",
  OFFLINE: "Offline — answers will be saved when you reconnect",
};

export default function SaveStatus({ status, onRetry }) {
  return (
    <span role="status" aria-live="polite" data-status={status}>
      {TEXT[status]}{" "}
      {status === "FAILED" && <button type="button" className="btn btn-link" onClick={onRetry}>Retry now</button>}
    </span>
  );
}
