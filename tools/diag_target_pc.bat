@echo off
REM ================================================================
REM  CatDesktopPet - target PC diagnostic (ANSI/ASCII only)
REM
REM  Usage:
REM    1) drag CatDesktopPet.exe onto this file, or
REM    2) cmd:  diag_target_pc.bat "C:\path\CatDesktopPet.exe"
REM
REM  Output: pet_diag_report.txt on the Desktop
REM ================================================================
setlocal
set "EXE=%~1"
if "%EXE%"=="" set "EXE=%~dp0CatDesktopPet.exe"
set "EXEDIR=%~dp1"
if "%EXEDIR%"=="" set "EXEDIR=%~dp0"
set "REPORT=%USERPROFILE%\Desktop\pet_diag_report.txt"

echo === CatDesktopPet diagnostic report === > "%REPORT%"
echo generated: %DATE% %TIME% >> "%REPORT%"
echo. >> "%REPORT%"

echo [1] OS version >> "%REPORT%"
ver >> "%REPORT%" 2>&1
echo. >> "%REPORT%"

echo [2] Environment variables that break Electron apps >> "%REPORT%"
if defined ELECTRON_RUN_AS_NODE (echo ELECTRON_RUN_AS_NODE = FOUND - the exe would run as plain Node: process alive, NO window >> "%REPORT%") else (echo ELECTRON_RUN_AS_NODE = not set, OK >> "%REPORT%")
if defined NODE_OPTIONS (echo NODE_OPTIONS = FOUND - may break the exe, value below >> "%REPORT%") else (echo NODE_OPTIONS = not set, OK >> "%REPORT%")
if defined NODE_OPTIONS echo   NODE_OPTIONS value: %NODE_OPTIONS% >> "%REPORT%"
echo. >> "%REPORT%"

echo [3] Target exe >> "%REPORT%"
if not exist "%EXE%" (
  echo ERROR: exe not found: %EXE% >> "%REPORT%"
) else (
  echo exe: %EXE% >> "%REPORT%"
  for %%F in ("%EXE%") do echo size, bytes: %%~zF >> "%REPORT%"
  powershell -NoProfile -Command "(Get-Item -LiteralPath '%EXE%').VersionInfo.FileVersion" >> "%REPORT%" 2>&1
)
if exist "%EXEDIR%resources\app.asar" (
  echo resources\app.asar = FOUND, install looks complete >> "%REPORT%"
) else (
  echo resources\app.asar = NOT found next to exe - normal for single-file Portable exe, otherwise INCOMPLETE copy of win-unpacked folder >> "%REPORT%"
)
echo. >> "%REPORT%"

echo [4] Launch test >> "%REPORT%"
echo note: if the pet was already running before this test, RUNNING may refer to that old instance >> "%REPORT%"
start "" "%EXE%"
ping -n 9 127.0.0.1 >nul
tasklist /FI "IMAGENAME eq CatDesktopPet.exe" 2>nul | findstr /I "CatDesktopPet.exe" >nul
if errorlevel 1 (
  echo after 8s: process NOT running - launch fails, see [5] below >> "%REPORT%"
) else (
  echo after 8s: process RUNNING - if no pet visible, check tray overflow area ^(^) or env vars in [2] >> "%REPORT%"
)
echo. >> "%REPORT%"

echo [5] Recent app-crash events (Application log, IDs 1000/1001/1002, newest 5) >> "%REPORT%"
powershell -NoProfile -Command "Get-WinEvent -FilterHashtable @{LogName='Application';Id=1000,1001,1002} -MaxEvents 5 -ErrorAction SilentlyContinue | ForEach-Object { '' + $_.TimeCreated + ' | ID ' + $_.Id + ' | ' + (($_.Message -split ([char]10))[0..2] -join ' // ') }" >> "%REPORT%" 2>&1
echo. >> "%REPORT%"

echo [6] User data folder %%APPDATA%%\cat-desktop-pet >> "%REPORT%"
if exist "%APPDATA%\cat-desktop-pet" (
  dir /B "%APPDATA%\cat-desktop-pet" >> "%REPORT%" 2>&1
) else (
  echo folder not created yet - app very likely never started successfully on this PC >> "%REPORT%"
)
echo. >> "%REPORT%"

echo === end of report === >> "%REPORT%"
echo Report saved to: %REPORT%
start notepad "%REPORT%"
endlocal
