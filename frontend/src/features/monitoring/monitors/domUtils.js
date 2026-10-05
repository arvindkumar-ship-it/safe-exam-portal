// Shared helper: target editable (input/textarea/contenteditable) hai ya nahi.
export function isEditableTarget(target) {
  if (!target || !target.closest) return false;
  if (target.closest('input, textarea')) return true;
  const ce = target.closest('[contenteditable]');
  if (!ce) return false;
  const v = (ce.getAttribute('contenteditable') || '').toLowerCase();
  return v === '' || v === 'true' || v === 'plaintext-only';
}
