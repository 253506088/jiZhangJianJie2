@echo off
setlocal
title Jianjie Ledger - Build APK
cd /d "%~dp0"

echo Building the signed Android Release APK...
echo Project: %CD%
echo.
where node.exe >nul 2>&1
if errorlevel 1 (
  echo ERROR: Node.js is unavailable. Enable your existing Node 24.13.0 first.
  goto :failed
)
where npm.cmd >nul 2>&1
if errorlevel 1 (
  echo ERROR: npm is unavailable in this console.
  goto :failed
)
if not exist "node_modules\@capacitor\cli\bin\capacitor" (
  echo Installing the locked project dependencies into this folder...
  call npm.cmd ci
  if errorlevel 1 goto :failed
)

where pwsh.exe >nul 2>&1
if errorlevel 1 (
  powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\build-android.ps1" -BuildType Release
) else (
  pwsh.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\build-android.ps1" -BuildType Release
)
if errorlevel 1 goto :failed

echo.
echo SUCCESS: Signed APK built and verified.
echo APK: %~dp0artifacts\jizhang-jianjie2-release.apk
echo Build details: %~dp0artifacts\release-build.json
echo Keep .local\signing safe: future updates need the same signing key.
if /i not "%~1"=="--no-pause" pause
exit /b 0

:failed
echo.
echo BUILD FAILED. Read the error above; no global Node or Java settings were changed.
echo Any older APK in artifacts is NOT the result of this failed build.
if /i not "%~1"=="--no-pause" pause
exit /b 1
