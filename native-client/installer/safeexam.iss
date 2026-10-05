; SafeExam native client installer (Inno Setup 6). Build: iscc installer\safeexam.iss
; Pehle publish: dotnet publish src\SafeExam.Client -c Release -r win-x64 --self-contained false -o publish
#define AppName "SafeExam"
#define AppVersion "1.0.0"
#define AppExe "SafeExam.Client.exe"

[Setup]
AppId={{7E1B3C52-5A0D-4B7E-9C60-5AFE0E1A0001}
AppName={#AppName}
AppVersion={#AppVersion}
AppPublisher=SafeExam
DefaultDirName={localappdata}\Programs\SafeExam
DefaultGroupName=SafeExam
PrivilegesRequired=lowest
PrivilegesRequiredOverridesAllowed=dialog
MinVersion=10.0
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
OutputDir=dist
OutputBaseFilename=SafeExam-Setup-{#AppVersion}
Compression=lzma2
SolidCompression=yes
CloseApplications=yes
UninstallDisplayIcon={app}\{#AppExe}
; Code signing (real certificate ke saath):  iscc /Ssigntool="signtool sign /fd SHA256 /tr http://timestamp.digicert.com /td SHA256 /a $f" safeexam.iss
; SignTool=signtool
; SignedUninstaller=yes

[Files]
Source: "..\publish\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs

[Icons]
Name: "{autoprograms}\SafeExam"; Filename: "{app}\{#AppExe}"

[Registry]
; .safeexam double-click => client config ke saath khulta hai (per-user)
Root: HKCU; Subkey: "Software\Classes\.safeexam"; ValueType: string; ValueData: "SafeExam.Config"; Flags: uninsdeletevalue
Root: HKCU; Subkey: "Software\Classes\SafeExam.Config"; ValueType: string; ValueData: "SafeExam exam file"; Flags: uninsdeletekey
Root: HKCU; Subkey: "Software\Classes\SafeExam.Config\shell\open\command"; ValueType: string; ValueData: """{app}\{#AppExe}"" ""%1"""

[Run]
Filename: "{app}\{#AppExe}"; Parameters: "--diagnostics"; Flags: runhidden skipifsilent; Description: "Self-check"

[UninstallRun]
; C-21: DPAPI blobs + local data wipe (idempotent)
Filename: "{app}\{#AppExe}"; Parameters: "--wipe"; Flags: runhidden; RunOnceId: "SafeExamWipe"

[UninstallDelete]
Type: filesandordirs; Name: "{localappdata}\SafeExam\webview-profile"
Type: filesandordirs; Name: "{localappdata}\SafeExam\data"
Type: files; Name: "{localappdata}\SafeExam\running.lock"

[Code]
// WebView2 Evergreen Runtime check (per-user ya per-machine)
function WebView2Installed(): Boolean;
var v: String;
begin
  Result := RegQueryStringValue(HKLM, 'SOFTWARE\WOW6432Node\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}', 'pv', v)
         or RegQueryStringValue(HKCU, 'Software\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}', 'pv', v);
  if Result then Result := (v <> '') and (v <> '0.0.0.0');
end;

function InitializeSetup(): Boolean;
begin
  Result := True;
  if not WebView2Installed() then
    MsgBox('Microsoft WebView2 Runtime was not found. After setup, install it from https://go.microsoft.com/fwlink/p/?LinkId=2124703 (Evergreen Bootstrapper) before starting SafeExam.', mbInformation, MB_OK);
end;

// Uninstall: logs rakhne ka option
procedure CurUninstallStepChanged(CurUninstallStep: TUninstallStep);
begin
  if CurUninstallStep = usPostUninstall then
    if MsgBox('Also delete SafeExam log files?', mbConfirmation, MB_YESNO) = IDYES then
      DelTree(ExpandConstant('{localappdata}\SafeExam\logs'), True, True, True);
end;
