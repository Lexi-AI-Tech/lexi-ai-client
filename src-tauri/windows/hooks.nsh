; Included near the top of Tauri's generated installer.nsi (before MUI pages).
; Use !define for Modern UI strings — do not use !insertmacro MUI_WELCOMEPAGE_TITLE (that macro does not exist).

; Installer — welcome
!define MUI_WELCOMEPAGE_TITLE "Welcome to Lexi AI"
!define MUI_WELCOMEPAGE_TEXT "This installs Lexi AI on your computer.$\r$\n$\r$\nClick Next to continue, or Cancel to exit."

; Installer — finish (Tauri adds Run / desktop shortcut after these)
!define MUI_FINISHPAGE_TITLE "Installation complete"
!define MUI_FINISHPAGE_TEXT "Lexi AI is ready to use. You can launch it from the Start menu or from the shortcut on your desktop."

; Uninstaller — confirm page body (see NSIS Contrib\Modern UI 2\Pages\UninstallConfirm.nsh)
!define MUI_UNCONFIRMPAGE_TEXT_TOP "Lexi AI will be removed from this computer.$\r$\n$\r$\nClick Next to uninstall, or Cancel to keep the app."
!define MUI_UNCONFIRMPAGE_TEXT_LOCATION ""

; Optional lifecycle hooks (uncomment and customize as needed):
; !macro NSIS_HOOK_PREINSTALL
; !macroend
;
; !macro NSIS_HOOK_POSTINSTALL
; !macroend
;
; !macro NSIS_HOOK_PREUNINSTALL
; !macroend
;
; !macro NSIS_HOOK_POSTUNINSTALL
; !macroend
