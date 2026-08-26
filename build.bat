@echo off
title Mini Program Dev Helper
setlocal enabledelayedexpansion
set "PROJ=C:\Users\86183\Desktop\Projects\personal-ledger-miniprogram"
set "CLI=C:\Program Files (x86)\Tencent\微信web开发者工具\cli.bat"
cd /d "%PROJ%"

echo [1/2] Syntax check (js)...
node --check utils\cloud.js >nul 2>nul || (echo FAIL: utils\cloud.js & pause & exit /b 1)
node --check utils\storage.js >nul 2>nul || (echo FAIL: utils\storage.js & pause & exit /b 1)
node --check utils\time.js >nul 2>nul || (echo FAIL: utils\time.js & pause & exit /b 1)
echo OK

echo [2/2] Files saved - devtools hot reload refreshes simulator automatically
echo (Use "build.bat full" to force a manual compile)

if /i "%~1"=="full" (
  echo.
  echo [Manual compile]...
  "%CLI%" auto --project "%PROJ%"
  if errorlevel 1 (echo FAIL: compile error & pause & exit /b 1)
  echo PASS: compile OK
)
timeout /t 2 >nul
