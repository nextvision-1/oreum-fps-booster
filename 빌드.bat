@echo off
chcp 65001 >nul
cd /d "%~dp0"
where npm >nul 2>nul || (echo Node.js가 필요합니다. & pause & exit /b 1)
call npm install || (pause & exit /b 1)
call npm run build || (pause & exit /b 1)
echo.
echo 완료! dist 폴더에 portable.exe 와 setup.exe 가 생성되었습니다.
explorer dist
pause
