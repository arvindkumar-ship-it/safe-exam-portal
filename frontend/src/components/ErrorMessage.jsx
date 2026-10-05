import { toUserMessage } from "../utils/errors";

export default function ErrorMessage({ error, message }) {
  const text = message || toUserMessage(error);
  if (!text) return null;
  return (
    <div role="alert" className="error-message">
      {text}
    </div>
  );
}
