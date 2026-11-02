@echo off
REM 우리 가족 하루 체크 서버 실행 (Windows)
chcp 65001 > nul
cd /d "%~dp0\.."
if not exist node_modules (
  echo 처음 실행: 패키지를 설치합니다...
  call npm install --omit=dev
)
call npm start
pause
