; Inno Setup — Virtual Tracker Agent (Windows)
; Requires PyInstaller onedir output at dist\VirtualTrackerAgent\

#define MyAppName "Virtual Tracker Agent"
#define MyAppVersion "0.2.0"
#define MyAppPublisher "Virtual Tracker"
#define MyAppExeName "VirtualTrackerAgent.exe"
#define BuildDir "..\dist\VirtualTrackerAgent"

[Setup]
AppId={{A7B3C9D1-4E2F-4A8B-9C1D-2E3F4A5B6C7D}
AppName={#MyAppName}
AppVersion={#MyAppVersion}
AppPublisher={#MyAppPublisher}
DefaultDirName={autopf}\Virtual Tracker Agent
DefaultGroupName={#MyAppName}
DisableProgramGroupPage=yes
OutputDir=..\dist
OutputBaseFilename=VirtualTrackerAgent-Setup
Compression=lzma2
SolidCompression=yes
WizardStyle=modern
PrivilegesRequired=lowest

[Languages]
Name: "english"; MessagesFile: "compiler:Default.isl"

[Files]
Source: "{#BuildDir}\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs

[Icons]
Name: "{group}\{#MyAppName}"; Filename: "{app}\{#MyAppExeName}"
Name: "{userstartup}\{#MyAppName}"; Filename: "{app}\{#MyAppExeName}"; Tasks: autostart

[Tasks]
Name: "autostart"; Description: "Start Virtual Tracker Agent when Windows starts"; GroupDescription: "Startup:"; Flags: checkedonce

[Run]
Filename: "{app}\{#MyAppExeName}"; Description: "Launch {#MyAppName}"; Flags: nowait postinstall skipifsilent

[UninstallDelete]
Type: filesandordirs; Name: "{userstartup}\Virtual Tracker Agent.lnk"
