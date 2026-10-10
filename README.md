# SafeExam — Products A + B + C (one repo)

FastAPI + PostgreSQL backend, React + Vite frontend. Backend modules A-01..A-24, frontend modules F-01..F-08 and web monitoring modules B-01..B-24 are implemented and integrated in this one repo. Product C (Windows native lockdown client, .NET 8 WPF + WebView2) lives in `native-client/` — see `docs/INTEGRATION.md` for how the three fit together and `native-client/README.md` to build it.

## Run locally (Windows PowerShell)

```powershell
# 1) Database + backend
docker compose up --build            # db :5432, backend :8000

# 2) Frontend
cd frontend
copy .env.example .env
npm install
npm run dev                          # http://localhost:5173
```

Backend without Docker:
```powershell
cd backend
python -m venv .venv ; .\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
copy .env.example .env               # JWT_SECRET min 32 chars
alembic upgrade head
uvicorn app.main:app --reload --port 8000
```

## Tests
```powershell
cd backend ; pytest                  # needs TEST_DATABASE_URL (PostgreSQL), see .env.example
cd frontend ; npm test               # Vitest + React Testing Library
```
Last verified: backend 165 passed (incl. 7 C-contract tests), frontend 241 passed (46 Product A + 195 Product B), `vite build` + `npm run verify:bundle` OK.

## Roles
`POST /auth/register` always creates a STUDENT. Instructor / Reviewer / Admin accounts are created by an admin via `POST /users` (create the first admin with `cd backend; python scripts/create_admin.py admin@example.com "Admin"`).

## Frontend notes
- Access token lives in memory only; refresh token in `sessionStorage` (documented risk; move to an HttpOnly cookie later).
- All HTTP goes through `src/api/*`; pages never call `fetch` directly.
- Product B is wired in: `features/attempt/ExamShell.jsx` wraps the exam in `MonitoringProvider` (visibility, focus, fullscreen, clipboard, shortcuts, context menu, selection, network, heartbeat monitors), uploads events to `POST /attempts/{id}/events` through an IndexedDB-backed queue, keeps answers in an AES-GCM encrypted offline queue, and binds the native client (Product C) when `window.chrome.webview` exists.
- Routes `/system-check` and `/system-check/practice` run the readiness check (B-14..B-16).
- The instructor UI is a separate lazy chunk (`instructor-*.js`) so the student bundle never contains answer-key field names (`npm run verify:bundle`).
- Monitoring limitations: see `docs/PRODUCT_B_LIMITATIONS.md`. Test map: `docs/TEST_COVERAGE.md`. CSP/header snippet for production: `infra/nginx.conf`.

## Known limitations
- This platform does **not** stop cheating 100%. It reduces common digital cheating opportunities, records suspicious behaviour, and gives evidence for human review.
- Browser events are signals, not proof. A network disconnect is not cheating.
- Nothing can stop a photo of the screen taken with a second phone — question design (variants, unique parameters, a large pool) matters too.
- The risk score is not a final verdict; manual review and appeal are mandatory.

## Impact metrics (measure before claiming)
`answer_save_failure_rate`, `submission_failure_rate`, `duplicate_submission_rate` (target 0), `event_upload_success_rate`, average investigation time per flagged attempt, `false_positive_review_rate`. Targets (not achieved claims): answer loss < 0.1%, event upload success > 99%, auto-submit duplicates 0.

## Launch checklist
HTTPS · secrets in env · DB backups · CORS restricted · rate limiting · JWT expiry · Argon2 · admin MFA (future) · no passwords/answers in logs · privacy notice · load test.

Audit repair scope, reproducible checks and remaining limitations: [AUDIT_FIXES.md](AUDIT_FIXES.md).
