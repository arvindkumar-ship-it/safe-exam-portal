# Product B — Test coverage map (spec Section 6 test gates)

Run: `cd frontend && npm test`  (Vitest + RTL + jsdom + fake-indexeddb)

| Module | Test file |
| :-- | :-- |
| B-01 Architecture | `__tests__/b01-architecture.test.jsx` |
| B-02 Visibility · B-03 Focus · B-04 Fullscreen · B-05 Clipboard · B-06 Shortcuts · B-07 Context menu · B-08 Selection · B-09 Network · B-10 Heartbeat | `__tests__/monitors.test.jsx` |
| B-11 Event factory | `__tests__/b11-event-factory.test.js` |
| B-12 Event queue + IndexedDB store | `__tests__/b12-event-queue.test.js` |
| B-13 Event uploader | `__tests__/b13-event-uploader.test.js` |
| B-14 System check · B-15 Camera · B-16 Microphone (+ permission monitor) | `__tests__/b14-16-system-check.test.jsx` |
| B-17 Web exam shell | `__tests__/b17-shell.test.jsx` |
| B-18 Server-synced timer | `__tests__/b18-timer.test.jsx` |
| B-19 Offline-safe autosave (crypto + answer queue) | `__tests__/b19-autosave.test.jsx` |
| B-20 Student monitoring UX | `__tests__/b20-student-ux.test.jsx` |
| B-21 Accessibility mode | `__tests__/b21-accessibility.test.jsx` |
| B-22 Browser compatibility | `__tests__/b22-browser-support.test.jsx` |
| B-23 Offline recovery | `__tests__/b23-offline-recovery.test.jsx` |
| B-24 Security hardening (incl. a real `vite build` bundle scan) | `__tests__/b24-security.test.jsx` |

## Fixes made while writing tests
- `src/test/listeners.js`: `trackListeners` re-spied already-spied targets -> "Maximum call stack size exceeded" (7 monitor tests failed). Now restores before re-spying.
- `events/eventUploader.js`: if the server acked/rejected nothing, `flush()` looped forever (hot loop / OOM). Added a progress guard -> treated as a failed attempt with exponential backoff.

## Integration notes (A + B in one repo)
- Shell tests (`b17`, `b21`) stub `auth/useAuth.js` (real token bus) because the real `useAuth` needs `<AuthProvider>`; `b22` renders the real `App` via `renderAt`.
- `b24-build.test.js` runs in the node environment (a real `vite build` cannot run under jsdom).
- B-24 rule changed deliberately: localStorage is never used; sessionStorage is allowed **only** in `auth/AuthProvider.jsx` for the A-documented refresh token (never the access token or answers).
- Autosave status uses `FAILED` (Product A F-05 contract), not `ERROR`.
- Version-conflict detection accepts the backend code `ANSWER_VERSION_CONFLICT` (and HTTP 409).
