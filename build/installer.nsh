; Desinstalador: remove a preferência de GPU do Windows gravada pelo Forgia
; (Configurações > Gráficos). Numa atualização o valor é mantido.
!macro customUnInstall
  ${ifNot} ${isUpdated}
    DeleteRegValue HKCU "Software\Microsoft\DirectX\UserGpuPreferences" "$INSTDIR\Forgia.exe"
  ${endIf}
!macroend
