import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';

// Product A ka real useAuth AuthProvider maangta hai; shell tests ke liye chhota stub (token bus real).
vi.mock('../../../auth/useAuth.js', async () => {
  const bus = await import('../../../auth/tokenBus.js');
  return { useAuth: () => ({ accessToken: null, user: null, isAuthenticated: false }), onAccessTokenChange: bus.onAccessTokenChange };
});
vi.mock('../../../api/eventApi.js', () => ({ sendEvents: vi.fn() }));
vi.mock('../../../api/attemptApi.js', () => ({
  saveAnswer: vi.fn(async () => ({ version: 1 })), submit: vi.fn(async () => ({ status: 'SUBMITTED' })),
  heartbeat: vi.fn(async () => ({ serverTime: new Date().toISOString(), expiresAt: new Date(Date.now() + 3.6e6).toISOString(), attemptStatus: 'IN_PROGRESS' })),
}));

import { sendEvents } from '../../../api/eventApi.js';
import { createClipboardMonitor } from '../monitors/clipboardMonitor.js';
import { createShortcutMonitor } from '../monitors/shortcutMonitor.js';
import { createContextMenuMonitor } from '../monitors/contextMenuMonitor.js';
import { createSelectionMonitor } from '../monitors/selectionMonitor.js';
import { resolvePolicy } from '../policy.js';
import ExamShell from '../../attempt/ExamShell.jsx';
import { trackListeners } from '../../../test/listeners.js';
import fs from 'node:fs';
import path from 'node:path';

let n = 0;
const attempt = (policy) => ({
  id: `a11y-${++n}`, expiresAt: new Date(Date.now() + 3.6e6).toISOString(), serverTime: new Date().toISOString(), monitoringPolicy: policy,
  questions: [{ id: 'q1', type: 'MCQ_SINGLE', marks: 1, prompt: 'Pick', options: [{ id: 'a', text: 'A' }, { id: 'b', text: 'B' }] }, { id: 'q2', type: 'SHORT_TEXT', marks: 1, prompt: 'Why?' }],
});
const cancelable = (type, init = {}) => new (type === 'keydown' ? KeyboardEvent : Event)(type, { bubbles: true, cancelable: true, ...init });
const spyEvents = [];
const cleanups = [];
afterEach(() => { cleanups.splice(0).forEach((c) => c()); spyEvents.length = 0; });

describe('B-21 accessibility mode: nothing is blocked, everything is flagged', () => {
  it('clipboard: no preventDefault, event flagged', () => {
    const report = vi.fn();
    cleanups.push(createClipboardMonitor(report, { accessibilityMode: true }));
    for (const t of ['copy', 'cut', 'paste']) { const e = cancelable(t); document.dispatchEvent(e); expect(e.defaultPrevented).toBe(false); }
    expect(report).toHaveBeenCalledWith('CLIPBOARD_ATTEMPT', { action: 'copy', blocked: false, accessibilityMode: true });
    expect(report).toHaveBeenCalledTimes(3);
  });

  it('shortcuts: no preventDefault, event flagged', () => {
    const report = vi.fn();
    cleanups.push(createShortcutMonitor(report, { accessibilityMode: true }));
    for (const init of [{ key: 'c', ctrlKey: true }, { key: 'F12' }, { key: 'p', ctrlKey: true }]) {
      const e = cancelable('keydown', init); document.dispatchEvent(e); expect(e.defaultPrevented).toBe(false);
    }
    expect(report.mock.calls.every(([, meta]) => meta.accessibilityMode === true)).toBe(true);
    expect(report).toHaveBeenCalledTimes(3);
  });

  it('context menu: allowed and flagged', () => {
    const report = vi.fn();
    cleanups.push(createContextMenuMonitor(report, { accessibilityMode: true }));
    const e = cancelable('contextmenu'); document.dispatchEvent(e);
    expect(e.defaultPrevented).toBe(false);
    expect(report).toHaveBeenCalledWith('CONTEXT_MENU_ATTEMPT', { blocked: false, accessibilityMode: true });
  });

  it('selection/drag blocking is fully disabled (screen readers can select)', () => {
    document.body.innerHTML = '<main data-exam-content><p id="p">text</p></main>';
    cleanups.push(createSelectionMonitor({ block: true, accessibilityMode: true }));
    expect(document.querySelector('[data-exam-content]').classList.contains('exam-no-select')).toBe(false);
    const e = cancelable('selectstart'); document.getElementById('p').dispatchEvent(e);
    expect(e.defaultPrevented).toBe(false);
    document.body.innerHTML = '';
  });

  it('same inputs WITHOUT accessibility mode are blocked (control check)', () => {
    cleanups.push(createClipboardMonitor(vi.fn(), { accessibilityMode: false }));
    const e = cancelable('copy'); document.dispatchEvent(e);
    expect(e.defaultPrevented).toBe(true);
  });

  it('resolvePolicy keeps accessibilityMode only for real booleans', () => {
    expect(resolvePolicy({ accessibilityMode: true }).accessibilityMode).toBe(true);
    expect(resolvePolicy({ accessibilityMode: 'yes' }).accessibilityMode).toBe(false);
  });
});

describe('B-21 full flow with the real provider', () => {
  beforeEach(() => {
    vi.mocked(sendEvents).mockImplementation(async (_id, evs) => ({ source: 'WEB_CLIENT', acknowledgedUpTo: evs[evs.length - 1].clientSequence, accepted: evs.length, duplicates: 0, rejected: [] }));
  });

  it('uploaded events carry metadata.accessibilityMode=true and copy is not prevented', async () => {
    const t = trackListeners(window);
    render(<ExamShell attempt={attempt({ accessibilityMode: true })} consentGiven onSubmitted={vi.fn()} />);
    await waitFor(() => expect(t.count('blur')).toBe(1));
    const copy = cancelable('copy'); document.dispatchEvent(copy);
    window.dispatchEvent(new Event('blur'));
    expect(copy.defaultPrevented).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: 'Submit exam' }));
    fireEvent.click(screen.getByRole('button', { name: 'Confirm submit' }));
    await waitFor(() => expect(sendEvents).toHaveBeenCalled());
    const events = vi.mocked(sendEvents).mock.calls.flatMap((c) => c[1]);
    expect(events.length).toBeGreaterThanOrEqual(2);
    expect(events.every((e) => e.metadata.accessibilityMode === true)).toBe(true);
  });

  it('shows the accessibility notice and a11y class; screen-reader labels exist', () => {
    const { container } = render(<ExamShell attempt={attempt({ accessibilityMode: true })} consentGiven onSubmitted={vi.fn()} />);
    expect(screen.getByRole('note', { name: 'Accessibility mode' })).toBeInTheDocument();
    expect(container.querySelector('.exam-shell--a11y')).not.toBeNull();
    expect(screen.getByRole('timer', { name: 'Time remaining' })).toBeInTheDocument();
    expect(screen.getByRole('navigation', { name: 'Question navigation' })).toBeInTheDocument();
    expect(screen.getByRole('main', { name: 'Exam question' })).toBeInTheDocument();
    expect(screen.getByRole('group', { name: /Pick/ })).toBeInTheDocument(); // fieldset+legend = prompt
    expect(screen.getByText('Question 1 of 2')).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'A' })).toBeInTheDocument();
  });

  it('keyboard-only exam is completable: answer, navigate with keys, submit via modal + Escape', async () => {
    const onSubmitted = vi.fn();
    render(<ExamShell attempt={attempt({ accessibilityMode: true })} consentGiven onSubmitted={onSubmitted} />);
    const main = screen.getByRole('main', { name: 'Exam question' });
    screen.getByRole('radio', { name: 'B' }).focus();
    fireEvent.click(document.activeElement);                           // Space on a focused radio == click
    fireEvent.keyDown(main, { key: 'ArrowRight', altKey: true });     // next question
    const area = screen.getByRole('textbox', { name: 'Answer for question 2' });
    area.focus(); fireEvent.change(area, { target: { value: 'because' } });
    screen.getByRole('button', { name: 'Submit exam' }).focus();
    fireEvent.click(document.activeElement);                          // Enter on focused button
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByRole('button', { name: 'Confirm submit' })).toHaveFocus();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Submit exam' }));
    fireEvent.click(screen.getByRole('button', { name: 'Confirm submit' }));
    await waitFor(() => expect(onSubmitted).toHaveBeenCalled());
  });

  it('no focusable control is removed from the tab order', () => {
    const { container } = render(<ExamShell attempt={attempt({ accessibilityMode: true })} consentGiven onSubmitted={vi.fn()} />);
    const negative = [...container.querySelectorAll('button, input, textarea, a[href]')].filter((el) => el.getAttribute('tabindex') === '-1');
    expect(negative).toHaveLength(0);
  });
});

describe('B-21 zoom / layout sanity (200%)', () => {
  const css = fs.readFileSync(path.resolve(__dirname, '../../../monitoring.css'), 'utf8');
  it('layout containers wrap and use relative units so 200% zoom does not break', () => {
    for (const sel of ['.status-bar', '.exam-body', '.exam-actions', '.question-nav ol']) {
      const rule = css.split('}').find((r) => r.trim().startsWith(sel));
      expect(rule, sel).toMatch(/flex-wrap:\s*wrap/);
    }
    expect(css).not.toMatch(/overflow:\s*hidden/);       // never clip zoomed content
    expect(css).toMatch(/:focus-visible/);              // visible keyboard focus
    expect(css).toMatch(/\.skip-link/);
  });
});
