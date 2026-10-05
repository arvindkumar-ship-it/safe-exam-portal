import Button from "../../components/Button";
import ErrorMessage from "../../components/ErrorMessage";
import Modal from "../../components/Modal";

export default function SubmitDialog({ answered, total, onConfirm, onCancel, busy, error }) {
  return (
    <Modal title="Submit exam?" onClose={onCancel}>
      <p>You have answered {answered} of {total} questions. You cannot change answers after submitting.</p>
      <ErrorMessage error={error} />
      <div className="modal-actions">
        <Button variant="secondary" onClick={onCancel} disabled={busy}>Keep working</Button>
        <Button onClick={onConfirm} disabled={busy}>{busy ? "Submitting…" : "Submit now"}</Button>
      </div>
    </Modal>
  );
}
