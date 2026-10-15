; The legacy build's installer hooks (Windows 7, 8 and 8.1; tauri.legacy.conf.json):
; everything in installer-hooks-shared.nsh and no Windows version check, because this
; build also runs on Windows 10 and 11.
!include "${__FILEDIR__}\installer-hooks-shared.nsh"
