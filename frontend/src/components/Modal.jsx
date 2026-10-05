import { useEffect } from "react";

export default function Modal({ title, onClose, children }) {
  useEffect(() => {
    const onKey = (e) => e.key === "Escape" && onClose?.();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="modal-backdrop">
      <div role="dialog" aria-modal="true" aria-label={title} className="modal">
        <h2>{title}</h2>
        {children}
      </div>
    </div>
  );
}
