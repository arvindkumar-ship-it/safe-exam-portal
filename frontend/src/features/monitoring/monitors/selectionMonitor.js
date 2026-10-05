import { isEditableTarget } from './domUtils.js';

const CONTENT = '[data-exam-content]';
const CLASS = 'exam-no-select';

// Sirf deterrent: question area me select/drag band. Koi event report nahi hota.
// Inputs unaffected. accessibilityMode => poora disabled.
export function createSelectionMonitor({ block = true, accessibilityMode = false } = {}) {
  if (!block || accessibilityMode) return () => {};

  const apply = () => document.querySelectorAll(CONTENT).forEach((el) => el.classList.add(CLASS));
  apply();
  const observer = typeof MutationObserver !== 'undefined' ? new MutationObserver(apply) : null;
  if (observer) observer.observe(document.body, { childList: true, subtree: true });

  const handler = (e) => {
    const node = e.target && e.target.nodeType === 3 ? e.target.parentElement : e.target;
    if (!node || !node.closest || !node.closest(CONTENT)) return;
    if (isEditableTarget(node)) return;
    e.preventDefault();
  };
  document.addEventListener('selectstart', handler);
  document.addEventListener('dragstart', handler);
  return () => {
    document.removeEventListener('selectstart', handler);
    document.removeEventListener('dragstart', handler);
    if (observer) observer.disconnect();
    document.querySelectorAll(CONTENT).forEach((el) => el.classList.remove(CLASS));
  };
}
