; Installer hooks for Tauri's NSIS template, shared by both builds. Each build points
; bundle.windows.nsis.installerHooks at its own small file, which includes this one:
; installer-hooks.nsh (normal build, refuses Windows 7, 8 and 8.1) and
; installer-hooks-legacy.nsh (the build for those systems, no check).
;
; The app shipped as "Virtual Tracker Agent" before it was renamed to
; "My Virtual Tracker". Tauri's installer names the install folder, the Apps &
; Features entry, the Start menu and desktop shortcuts, and the start-at-login
; registry value after the product name, so updating across the rename would
; otherwise install a second copy beside the old one - both starting at login
; and both tracking time. PREINSTALL runs before this installer copies files or
; registers the virtualtracker:// link, so the old uninstaller can't touch
; anything the new install writes.
;
; A silent run of the old uninstaller never deletes app data (that only happens
; when its "delete app data" checkbox is ticked, which a silent run never
; shows), and app data lives under the unchanged bundle identifier anyway, so
; sign-in, preferences and queued activity all carry over.

!define VT_LEGACY_PRODUCTNAME "Virtual Tracker Agent"
!define VT_LEGACY_UNINSTKEY "Software\Microsoft\Windows\CurrentVersion\Uninstall\${VT_LEGACY_PRODUCTNAME}"

!macro VT_REMOVE_LEGACY_INSTALL ROOT
  ReadRegStr $R9 ${ROOT} "${VT_LEGACY_UNINSTKEY}" "InstallLocation"
  ${If} $R9 != ""
    ; Stored quoted, e.g. "C:\Program Files\Virtual Tracker Agent".
    StrCpy $R8 $R9 1
    ${If} $R8 == '"'
      StrCpy $R9 $R9 -1 1
    ${EndIf}
    ${If} ${FileExists} "$R9\uninstall.exe"
      DetailPrint "Removing the previous ${VT_LEGACY_PRODUCTNAME} install from $R9"
      ; _?= runs the uninstaller in place so ExecWait actually waits for it;
      ; it has to be the last argument and must not be quoted.
      ExecWait '"$R9\uninstall.exe" /S _?=$R9' $R8
      Delete "$R9\uninstall.exe"
      RMDir "$R9"
    ${EndIf}
  ${EndIf}
  ; Whatever the uninstaller left (or never had the chance to remove).
  DeleteRegKey ${ROOT} "${VT_LEGACY_UNINSTKEY}"
  DeleteRegKey ${ROOT} "${MANUKEY}\${VT_LEGACY_PRODUCTNAME}"
!macroend

!include "WinVer.nsh"

; Where a member on Windows 7, 8 or 8.1 gets the build that runs there
; (PLAN-windows-7-legacy-build.md). Set in installer-hooks.nsh, the normal build's file.
!ifndef VT_LEGACY_DOWNLOAD
  !define VT_LEGACY_DOWNLOAD "https://api.myvirtualtracker.com/api/download?platform=windows-legacy"
!endif

!macro NSIS_HOOK_PREINSTALL
  ; The normal build cannot start below Windows 10 (its WebView2 and its Rust runtime both
  ; need it), so it says so before copying anything, and names the build that does run.
  ; /SD IDOK lets a silent install (an update) stop the same way without waiting on a click.
  !ifdef VT_REQUIRE_WINDOWS_10
    ${IfNot} ${AtLeastWin10}
      MessageBox MB_OK|MB_ICONSTOP "This version of My Virtual Tracker needs Windows 10 or 11.$\r$\n$\r$\nFor Windows 7, 8 or 8.1, download the version for older Windows:$\r$\n${VT_LEGACY_DOWNLOAD}" /SD IDOK
      Abort
    ${EndIf}
  !endif
  Push $R8
  Push $R9
  !insertmacro VT_REMOVE_LEGACY_INSTALL HKLM
  !insertmacro VT_REMOVE_LEGACY_INSTALL HKCU
  ; The start-at-login value is per user; the app also removes it on first run
  ; for users other than the one running this installer.
  DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "${VT_LEGACY_PRODUCTNAME}"
  Pop $R9
  Pop $R8
!macroend

; The agent registers a per-user logon task (see src/autostart_task.rs) because
; a Run entry cannot start a requireAdministrator binary. Tauri's uninstaller
; knows about the Run value it wrote itself and nothing about these, so without
; this the tasks outlive the uninstall and Task Scheduler goes on trying to
; launch a deleted executable at every logon - once per user who ever enabled
; the setting.
;
; The wildcard covers every user's task in one call, which matters because the
; uninstaller runs as whoever launched it and cannot enumerate the others.
; nsExec::Exec rather than ExecWait so no console window flashes during a
; silent uninstall, and the result is discarded: a machine with no tasks
; registered is the desired end state, not a failure worth reporting.
!macro NSIS_HOOK_PREUNINSTALL
  Push $R9
  DetailPrint "Removing the start-at-login task"
  nsExec::Exec 'schtasks.exe /Delete /TN "\My Virtual Tracker\*" /F'
  Pop $R9
  ; /Delete does not remove the folder, so it is asked for separately; it
  ; fails harmlessly when the folder was never created.
  nsExec::Exec 'schtasks.exe /Delete /TN "\My Virtual Tracker" /F'
  Pop $R9
  Pop $R9
!macroend
