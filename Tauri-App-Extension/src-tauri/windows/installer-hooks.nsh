; The normal build's installer hooks: everything in installer-hooks-shared.nsh, plus
; stopping on Windows 7, 8 and 8.1, which this build cannot run on.
!define VT_REQUIRE_WINDOWS_10
!include "${__FILEDIR__}\installer-hooks-shared.nsh"
