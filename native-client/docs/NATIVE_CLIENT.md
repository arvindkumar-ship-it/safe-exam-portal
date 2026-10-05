# Product C — native client notes
- Build: `dotnet build SafeExam.sln` · Tests: `dotnet test` (Windows, .NET 8 SDK) · Publish: `dotnet publish src/SafeExam.Client -c Release -r win-x64 --self-contained false -o publish`
- CLI: `--config <file>` | `<file>.safeexam` | `--no-ui` | `--diagnostics` | `--wipe` | `--health-check`
- Dev mode: `SAFEEXAM_ENV=dev` (http://localhost allowed). Production me sirf HTTPS + signed config.
- Bridge: 4 commands only (`getClientVersion`, `getSessionStatus`, `reportNativeEvent`, `requestExit`), origin = `allowedHosts`.
- Limitations: see `deploy/windows-kiosk.md` §4.
