@echo off
chcp 65001 >nul
cd /d "%~dp0"
where npm >nul 2>nul || (echo Node.js가 필요합니다. & pause & exit /b 1)
if not exist tools mkdir tools
if not exist tools\PresentMon.exe (
  echo 게임 FPS 측정 도구(Intel PresentMon^) 내려받는 중...
  powershell -NoProfile -Command "Invoke-WebRequest -UseBasicParsing https://github.com/GameTechDev/PresentMon/releases/download/v2.6.0/PresentMon-2.6.0-x64.exe -OutFile tools\PresentMon.exe"
)
call npm install || (pause & exit /b 1)
call npm run build || (pause & exit /b 1)
echo.
echo 완료! dist 폴더에 portable.exe 와 setup.exe 가 생성되었습니다.
explorer dist
pause
