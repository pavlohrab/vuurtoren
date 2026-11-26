; Windows installer hooks (SY9): let phones on the home Wi-Fi reach "Connect a phone".
;
; The app listens on TCP 47120 (lan_cmd.rs PHONE_PORT). The installer runs without admin rights
; (installMode currentUser), so adding the firewall rule asks Windows for admin once, and only
; when the rule isn't there yet: updates don't ask again. Private networks only, so a café's
; Wi-Fi stays closed. Saying no is fine; Windows then asks when the app first listens.

!define VUURTOREN_FW_RULE "Vuurtoren phones"

!macro NSIS_HOOK_POSTINSTALL
  nsExec::ExecToStack 'netsh advfirewall firewall show rule name="${VUURTOREN_FW_RULE}"'
  Pop $0
  Pop $1
  ${If} $0 != 0
    ExecShellWait "runas" "netsh" 'advfirewall firewall add rule name="${VUURTOREN_FW_RULE}" dir=in action=allow protocol=TCP localport=47120 profile=private' SW_HIDE
  ${EndIf}
!macroend

!macro NSIS_HOOK_POSTUNINSTALL
  nsExec::ExecToStack 'netsh advfirewall firewall show rule name="${VUURTOREN_FW_RULE}"'
  Pop $0
  Pop $1
  ${If} $0 == 0
    ExecShellWait "runas" "netsh" 'advfirewall firewall delete rule name="${VUURTOREN_FW_RULE}"' SW_HIDE
  ${EndIf}
!macroend
