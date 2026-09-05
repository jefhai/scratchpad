; Private executable-path WFP policy. Never modify shared Edge/WebView2 policy.
!include "LogicLib.nsh"

Var ScratchpadInstallerMutex

!macro SCRATCHPAD_REQUIRE_EXCLUSIVE_SETUP
  ; A marker prevents app launch, but only this machine-wide handle serializes
  ; concurrent elevated installers. Windows releases it even after a crash.
  System::Call 'kernel32::CreateMutexW(p 0, i 1, w "Global\Scratchpad.Setup.9280b534-7dce-4e83-98b4-18c99a1a58e5") p .r0 ?e'
  Pop $R1
  StrCpy $ScratchpadInstallerMutex $0
  ${If} $ScratchpadInstallerMutex = 0
  ${OrIf} $R1 = 183
    SetErrorLevel 1
    Abort "Another Scratchpad setup or removal is already running, or its installation lock is unavailable."
  ${EndIf}
!macroend

!macro SCRATCHPAD_REQUIRE_CLOSED
  nsis_tauri_utils::FindProcess "scratchpad.exe"
  Pop $R0
  ${If} $R0 = 0
    SetErrorLevel 1
    Abort "Quit Scratchpad normally before installing or uninstalling. Your open workspaces must finish saving."
  ${EndIf}
!macroend

!macro NSIS_HOOK_POSTUNINSTALL
  ; The policy helper released this lock before its own binary was removed.
  Delete "$INSTDIR\.scratchpad-installing"
  Delete "$INSTDIR\offline-policy.lock"
  RMDir "$INSTDIR"
!macroend

!macro SCRATCHPAD_REQUIRE_LOCATION
  ${If} $INSTDIR != "$PROGRAMFILES64\Scratchpad"
    SetErrorLevel 1
    Abort "Scratchpad's offline policy requires installation in $PROGRAMFILES64\Scratchpad."
  ${EndIf}
!macroend

!macro NSIS_HOOK_PREINSTALL
  !insertmacro SCRATCHPAD_REQUIRE_EXCLUSIVE_SETUP
  !insertmacro SCRATCHPAD_REQUIRE_LOCATION
  !insertmacro SCRATCHPAD_REQUIRE_CLOSED
  ReadRegStr $R0 HKLM "SOFTWARE\Microsoft\Windows NT\CurrentVersion" "CurrentBuildNumber"
  ${If} $R0 < 22000
    SetErrorLevel 1
    Abort "Scratchpad requires Windows 11 (build 22000 or later)."
  ${EndIf}
  ; The new helper runs before copying application files. It verifies the
  ; protected destination and leaves a fail-closed installation marker.
  ; Existing filters stay in place until the replacement is verified.
  InitPluginsDir
  File "/oname=$PLUGINSDIR\scratchpad-policy.exe" "$%SCRATCHPAD_POLICY_BINARY%"
  nsExec::ExecToLog '"$PLUGINSDIR\scratchpad-policy.exe" prepare "$INSTDIR"'
  Pop $R0
  ${If} $R0 != 0
    SetErrorLevel 1
    Abort "Scratchpad could not safely prepare the protected installation. No application files have been replaced."
  ${EndIf}
!macroend

!macro NSIS_HOOK_POSTINSTALL
  nsExec::ExecToLog '"$INSTDIR\scratchpad-policy.exe" install "$INSTDIR"'
  Pop $R0
  ${If} $R0 != 0
    SetErrorLevel 1
    Abort "The offline network policy could not be installed. Scratchpad will not start without it. Re-run setup to repair the installation."
  ${EndIf}
  nsExec::ExecToLog '"$INSTDIR\scratchpad-policy.exe" audit "$INSTDIR"'
  Pop $R0
  ${If} $R0 != 0
    SetErrorLevel 1
    Abort "The offline network policy did not pass verification. Scratchpad will not start."
  ${EndIf}
!macroend

!macro NSIS_HOOK_PREUNINSTALL
  !insertmacro SCRATCHPAD_REQUIRE_EXCLUSIVE_SETUP
  !insertmacro SCRATCHPAD_REQUIRE_LOCATION
  !insertmacro SCRATCHPAD_REQUIRE_CLOSED
  nsExec::ExecToLog '"$INSTDIR\scratchpad-policy.exe" remove "$INSTDIR"'
  Pop $R0
  ${If} $R0 != 0
    SetErrorLevel 1
    Abort "Scratchpad's offline policy could not be removed safely. The application files have been retained."
  ${EndIf}
!macroend
