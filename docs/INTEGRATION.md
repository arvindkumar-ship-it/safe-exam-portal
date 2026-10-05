# A + B + C — how the three products fit together

```
 Student PC (Windows)                                   Server
┌────────────────────────────────────────┐        ┌───────────────────────┐
│ C: SafeExam.Client.exe (WPF kiosk)     │        │ A: FastAPI + Postgres │
│  ├─ signed .safeexam config (ECDSA)    │        │  /auth /exams /attempts│
│  ├─ native monitors (process, window,  │  HTTPS │  /events /heartbeat   │
│  │   display, clipboard, print)  ──────┼───────►│  risk score + audit   │
│  └─ WebView2 ── loads ───────────────┐ │ events │  chain + review queue │
│      ┌──────────────────────────────┐│ │        └───────────▲───────────┘
│      │ B: React web client (frontend)││ │ HTTPS              │
│      │  web monitors → events ───────┼┼─┼────────────────────┘
│      │  bridge: getSessionStatus ◄──►││ │  (source WEB_CLIENT)
│      └──────────────────────────────┘│ │
└────────────────────────────────────────┘
```
## Flow
1. Institution signs a `.safeexam` config (`native-client/scripts/sign_config.py`). Student opens it → C verifies signature/expiry/host allowlist.
2. C opens `examUrl` (the A+B frontend) in WebView2; only `allowedHosts` over HTTPS are navigable.
3. Student logs in on the web page and starts the attempt. B detects `window.chrome.webview` and calls bridge `getSessionStatus {attemptId, accessToken}` → C **binds** the session (heartbeat + native event upload start). Token refresh re-binds.
4. Two independent event streams hit `POST /attempts/{id}/events`: `WEB_CLIENT` (B) and `NATIVE_CLIENT` (C), each with its own `clientSequence`. Server computes severity/risk (client never sends it).
5. Terminal attempt status → C closes the session, final flush, releases the kiosk.
6. Reviewers see both sources in one timeline; the hash chain gives tamper evidence.

## Configuration checklist
| Where | Setting |
| :-- | :-- |
| backend `.env` | `ALLOWED_ORIGINS` must include the exam page origin (same origin as `examUrl` in the config) |
| `.safeexam` payload | `examUrl` host ∈ `allowedHosts`; `apiBaseUrl` = backend URL (https in prod) |
| frontend build | `VITE_API_BASE_URL` = backend URL; CSP `connect-src` includes it (`infra/nginx.conf`) |
| client dev | `SAFEEXAM_ENV=dev` allows `http://localhost` only |

## Frozen contracts (tests guard these)
- Event types: `backend/app/events/event_types.py` ⇄ `NativeEventTypes` (C) ⇄ `eventTypes.js` (B)
- Bridge protocol (4 commands): `nativeBridgeAdapter.js` ⇄ `Bridge/NativeBridge.cs`
- C→A wire format: `backend/tests/contract/test_native_client_contract.py`

## Verified in this build
- backend `pytest` → 165 passed (158 A + 7 C-contract) · frontend `npm test` → 241 passed
- native-client is Windows-only (WPF/WebView2/DPAPI) and was **not compiled or run** here — run `dotnet build` + `dotnet test` on Windows first (see `native-client/README.md`).
