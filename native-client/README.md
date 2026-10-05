# SafeExam — Product C (Windows native lockdown client)

WPF + WebView2 (.NET 8). Hosts the A+B exam website in a kiosk-like window and reports OS-level signals as **events (evidence, not verdicts)**.

## Build / test (Windows 10/11, .NET 8 SDK)
```powershell
cd native-client
dotnet build SafeExam.sln
dotnet test
dotnet publish src/SafeExam.Client -c Release -r win-x64 --self-contained false -o publish
iscc installer\safeexam.iss       # Inno Setup 6 -> installer\dist\SafeExam-Setup-1.0.0.exe
```
> Assembled and reviewed without a Windows toolchain: the first `dotnet build` / `dotnet test` on Windows is the real verification — fix any compile nits there.

## Run against the local dev stack
```powershell
pip install cryptography
python scripts\make_dev_config.py --exam-url http://localhost:5173/ --api http://localhost:8000
dotnet build
$env:SAFEEXAM_ENV="dev"; dotnet run --project src\SafeExam.Client -- --config dev.safeexam    # exit code: dev-exit
```
Backend `ALLOWED_ORIGINS` must include `http://localhost:5173`. `make_dev_config.py` writes a dev public key into `trusted_keys.json` — **don't ship that build**.

## Production signing
```powershell
python scripts\sign_config.py --gen-key keys\prod              # keep prod.priv.pem offline
# add prod.pub.pem to src\SafeExam.Client\Security\trusted_keys.json  {keyId, publicKeyPem, notAfter}
python scripts\sign_config.py --hash-exit-code "proctor-code"   # -> exitCodeSalt / exitCodeSha256
python scripts\sign_config.py --key keys\prod.priv.pem --key-id prod --in payload.json --out exam.safeexam
```
Key rotation = two keys in `trusted_keys.json`.

## CLI
`--config <file>` · `<file>.safeexam` · `--no-ui` · `--diagnostics` · `--wipe` · `--health-check`

## Deployment & limits
`deploy/windows-kiosk.md` · `docs/NATIVE_CLIENT.md`. On student-owned devices only this process is controlled (Alt+Tab, VMs, remote desktop, second phone/camera are not blocked).
