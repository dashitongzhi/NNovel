!macro customInstall
  SetOutPath "$PLUGINSDIR"
  File "/oname=$PLUGINSDIR\\installer-postinstall.ps1" "${PROJECT_DIR}\\scripts\\installer-postinstall.ps1"
  nsExec::ExecToLog '"$SYSDIR\\WindowsPowerShell\\v1.0\\powershell.exe" -NoProfile -ExecutionPolicy Bypass -File "$PLUGINSDIR\\installer-postinstall.ps1" -InstallDir "$INSTDIR" -AppExe "$INSTDIR\\${APP_EXECUTABLE_FILENAME}"'
  Pop $0
  DetailPrint "NNovel post-install exit code: $0"
!macroend
