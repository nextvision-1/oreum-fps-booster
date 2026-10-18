@echo off
chcp 65001 >nul
cd /d "%~dp0"
set "EXE="
for %%f in (OreumFPSBooster-*-portable.exe) do set "EXE=%%~ff"
if not defined EXE for %%f in (dist\OreumFPSBooster-*-portable.exe) do set "EXE=%%~ff"
if not defined EXE (
  echo OreumFPSBooster-...-portable.exe 를 이 파일과 같은 폴더에 두고 다시 실행하세요.
  pause
  exit /b 1
)
echo.
echo  Oreum FPS Booster 자가진단
echo  -----------------------------------------------------------
echo  1. 시스템 복원 지점을 만든 뒤, 최적화를 모두 적용했다가 원래대로 되돌려
echo     값이 정확히 돌아오는지 확인합니다. (이미 적용해 둔 항목은 건드리지 않음)
echo  2. 시스템 검사, 청소 스캔(삭제 없음), 벤치마크를 실행합니다.
echo  약 5분 걸립니다. Oreum FPS Booster 창과 게임을 닫고, 그동안 PC를 쓰지 마세요.
echo  끝나면 바탕화면에 보고서가 만들어지고 메모장으로 열립니다.
echo  -----------------------------------------------------------
pause
echo 관리자 권한을 허용해 주세요. 진행 중...
powershell -NoProfile -Command "Start-Process -FilePath $env:EXE -ArgumentList '--self-test' -Verb RunAs -Wait"
echo.
echo 끝났습니다. 바탕화면의 "OreumFPSBooster-자가진단-..." 파일 내용을 보내 주세요.
pause
