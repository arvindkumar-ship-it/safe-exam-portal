# Product B — Limitations & Security Notes

## Kya hai / kya nahi
Product B = browser ke andar monitoring + secure exam experience. **OS-level lockdown nahi** (Product C).
Browser events = **evidence signals, cheating proof nahi**. Final decision human review + server risk score (verdict nahi).

## Known limitations
- **Browser-level clipboard/shortcut blocking = deterrent, security boundary nahi.** Alternate keyboard, extension, OS tool, external device se bypass possible.
- JS se OS-level kuch control nahi: second device/camera, VM, remote desktop, OS screenshot tools.
- Events false positive de sakte hain (notification, accidental click, assistive tools).
- **Offline encrypted answer queue** (AES-GCM, non-extractable key in IndexedDB) same-origin deterrent hai; same-origin JS key use kar sakta hai.
- Selection/drag blocking sirf deterrent hai.

## Rules followed (R1–R9)
Server authoritative · monitor sirf report karta hai (kabhi terminate/submit nahi) · neutral event names · client severity nahi bhejta ·
metadata me clipboard text/password/token nahi · ack se pehle event delete nahi · har monitor cleanup return karta hai ·
consent + visible banner · accessibility mode (server side weight 0).

## Web security hardening (B-24)
- CSP: `index.html` meta + `infra/nginx.conf` header. `frame-ancestors` sirf header se kaam karta hai.
- `dangerouslySetInnerHTML` use nahi hota (grep test). Question prompt plain text + safe mini-markdown.
- Access token sirf memory me; `localStorage` me kabhi nahi. `console` me token/answers nahi.
- Answer key bundle me nahi: `npm run build && npm run verify:bundle`.
- Production me source maps off (`build.sourcemap=false`, nginx `.map` → 404).
- Dependency audit: `npm run audit:deps` (release se pehle chalao, high/critical fix karo).

## Extras / deviations (spec ke upar)
- `policy.offlineGraceSeconds` (default 300) add kiya (B-23 ne maanga).
- `resolvePolicy`: object flags (`clipboard`, `selection`) par `false` = poora band.
- `EventQueue.removeSequences`, `EventUploader.notify/isTerminal`, store `removeSequences` + persisted `lastSequence` (ack ke baad bhi sequence restart na ho).
- `MonitoringProvider` extras: optional props `onServerTime`, `onAttemptStatus`, `deps` (tests); context me `finalize`, `flush`, `policy`, `warningSeq`, `eventCount`, `lastWarningType`.
- Helpers: `utils/idb.js`, `monitors/domUtils.js`, `hooks/useServerClock.js`.
- Native bridge: exit command name `requestExit`; native push `{command:"reportNativeEvent", payload}` (spec me exact nahi tha).
- Version conflict: `ApiError.code==="VERSION_CONFLICT"` ya status 409; server version `error.details.version|currentVersion`.
- Heartbeat error codes `ATTEMPT_ALREADY_SUBMITTED / ATTEMPT_EXPIRED / ATTEMPT_NOT_ACTIVE` ⇒ terminal status (SUBMITTED / AUTO_SUBMITTED / TERMINATED).
- Product A modules (`api/client.js`, `auth/useAuth.js`, `api/attemptApi.js`, `ExamPage`, `ExamInstructions`, `ConsentNotice`, `MonitoringBanner`) yahan stub/minimal hain taaki repo akela chale; real Product A files se replace karo (exports same).
