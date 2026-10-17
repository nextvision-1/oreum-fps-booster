@echo off
chcp 65001 >nul
cd /d "%~dp0"
where npm >nul 2>nul || (echo Node.js가 필요합니다. https://nodejs.org 에서 LTS 버전을 설치하세요. & pause & exit /b 1)
if not exist node_modules (
  echo 처음 실행: 필요한 파일을 설치합니다. 1~3분 걸릴 수 있습니다...
  call npm install || (pause & exit /b 1)
)
call npm start
