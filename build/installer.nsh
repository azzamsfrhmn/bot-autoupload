; Dipanggil electron-builder di awal installer (.onInit).
; Update gagal "Failed to uninstall old application files" bila masih ada proses aplikasi lama yang
; mengunci file: jendela/tray aplikasi, driver Playwright (memakai Bot Auto Upload.exe), ffmpeg/Remotion
; dari folder aplikasi. Matikan semuanya dulu sebelum file versi lama dihapus.
!macro customInit
  nsExec::Exec 'taskkill /F /T /IM "Bot Auto Upload.exe"'
  nsExec::Exec `powershell -NoProfile -ExecutionPolicy Bypass -Command "Get-Process | Where-Object { $$_.Path -and ($$_.Path -like '*\Programs\bot-autoupload\*' -or $$_.Path -like '*\Programs\Bot Auto Upload\*') } | Stop-Process -Force -ErrorAction SilentlyContinue"`
  Sleep 2000
!macroend
