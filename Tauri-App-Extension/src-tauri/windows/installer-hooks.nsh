; Installer hooks for Tauri's NSIS template (bundle.windows.nsis.installerHooks).
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

!macro NSIS_HOOK_PREINSTALL
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
