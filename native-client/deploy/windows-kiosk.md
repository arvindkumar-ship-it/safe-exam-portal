# SafeExam — Windows deployment policy (C-24)

Ye doc **managed / institution-owned devices** ke liye hai. Student-owned laptop par client sirf apne process ko control karta hai
(R4: koi low-level hook/driver trick nahi). Strong enforcement = Windows policy.

## 1. Assigned Access (single-app kiosk)
1. Dedicated local user banao (e.g. `examkiosk`), standard (non-admin).
2. Settings → Accounts → *Other users* → **Set up a kiosk** → user chuno → app: **SafeExam** (`SafeExam.Client.exe`, Win32 app).
   Ya Intune: *Device configuration → Kiosk → Single app, full-screen kiosk → Add Win32 app* (path `%LOCALAPPDATA%\Programs\SafeExam\SafeExam.Client.exe`).
3. `.safeexam` file kiosk user ke desktop/profile me pehle se rakho; shortcut args me `--config <path>`.
4. Auto-logon + "Restart if app closes" enable karo; exit code sirf proctor ke paas.

## 2. AppLocker / WDAC
- `deploy/applocker-sample.xml` import karo (`Set-AppLockerPolicy -XmlPolicy ...`), pehle `AuditOnly`; Event Viewer → *AppLocker* me block-list dekho, phir `Enabled`.
- Validate: `Get-AppLockerPolicy -Xml -Local` (XML parse hona chahiye) aur `Test-AppLockerPolicy -XmlPolicy ... -Path SafeExam.Client.exe -User Everyone`.
- Production: WDAC (signed policy) AppLocker se strong hai; Publisher rule apne code-signing cert se match karo.

## 3. Group Policy / MDM
| Control | Policy |
| :-- | :-- |
| Task Manager disable | `User Config → Admin Templates → System → Ctrl+Alt+Del Options → Remove Task Manager` |
| Win key / shortcuts | Assigned Access already restricts; extra: `NoWinKeys` (GPO: Windows Components → File Explorer) |
| Alt+Tab | Kiosk mode me shell replace hota hai — code se block nahi karte |
| USB storage | `Computer Config → System → Removable Storage Access → All classes: Deny` |
| Sleep/lock | Power policy: no sleep during exam |
| Updates | Exam window ke bahar maintenance; client update exam active hone par block hota hai (C-19) |

## 4. Kya guarantee **nahi** hota
- Student-owned PC: Alt+Tab, VM, remote desktop, second monitor/phone/camera, OS screenshot tools bypass ho sakte hain.
- Process/window monitoring false positive de sakta hai (legit apps, accessibility tools). Native events = **evidence**, verdict nahi; final decision server risk score + human review (Product A).
- Is client ko "cheating 100% roka" claim ke saath mat bechna.

## 5. Pilot checklist
- [ ] Test VM par Assigned Access reproduce hua; Alt+Tab/Win key restricted
- [ ] AppLocker `AuditOnly` logs clean, phir `Enabled`; SafeExam launch OK
- [ ] `.safeexam` double-click / `--config` se exam load; invalid/expired config readable error
- [ ] `SafeExam.Client.exe --diagnostics` JSON: WebView2 present, API reachable, clock skew < 1 min
- [ ] Accessibility: Narrator/Magnifier/OSK accommodation config se test
- [ ] Network drop + reconnect: events queue, upload resume; crash (kill process) → resume session
- [ ] Reviewer dashboard me native events (`source=NATIVE_CLIENT`) dikhte hain
- [ ] Privacy notice + consent student ko diya
