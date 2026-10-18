@echo off
chcp 65001 >nul
cd /d "%~dp0"
where npm >nul 2>nul || (echo Node.js가 필요합니다. & pause & exit /b 1)
if not exist tools mkdir tools
if not exist tools\PresentMon.exe (
  echo 게임 FPS 측정 도구(Intel PresentMon^) 내려받는 중...
  powershell -NoProfile -Command "Invoke-WebRequest -UseBasicParsing https://github.com/GameTechDev/PresentMon/releases/download/v2.6.0/PresentMon-2.6.0-x64.exe -OutFile tools\PresentMon.exe"
)
rem 설치 파일에 넣기 전에 Intel 디지털 서명 확인. 실패하면 넣지 않음 (앱이 처음 측정할 때 다시 내려받음)
if exist tools\PresentMon.exe (
  powershell -NoProfile -Command "$s = Get-AuthenticodeSignature -LiteralPath 'tools\PresentMon.exe'; if ($s.Status -ne 'Valid' -or $s.SignerCertificate.Subject -notmatch '^CN=Intel Corporation,') { exit 1 }"
  if errorlevel 1 (
    echo 경고: PresentMon.exe 서명이 올바르지 않아 삭제합니다.
    del tools\PresentMon.exe
  )
)
call npm install || (pause & exit /b 1)
call npm run build || (pause & exit /b 1)
copy /y 자가진단.bat dist\ >nul
echo.
echo 완료! dist 폴더에 portable.exe 와 setup.exe 가 생성되었습니다.
explorer dist
pause
