@echo off
setlocal
cd /d "%~dp0"

set "NODE_EXE=C:\Program Files\nodejs\npm.cmd"
set "ELECTRON_EXE=node_modules\electron\dist\electron.exe"
set "MAIN_BUILD=out\main\index.js"
set "APP_EXE=dist\win-unpacked\Dermatherapy Note Maker.exe"
set "PORTABLE_EXE=dist\Dermatherapy Note Maker 0.1.0.exe"

if exist "%NODE_EXE%" (
  call "%NODE_EXE%" run build
)

if exist "%ELECTRON_EXE%" if exist "%MAIN_BUILD%" (
  start "" "%ELECTRON_EXE%" .
  exit /b 0
)

if exist "%APP_EXE%" (
  start "" "%APP_EXE%"
  exit /b 0
)

if exist "%PORTABLE_EXE%" (
  start "" "%PORTABLE_EXE%"
  exit /b 0
)

if exist "%NODE_EXE%" (
  call "%NODE_EXE%" run package
) else (
  call npm.cmd run package
)

if exist "%APP_EXE%" (
  start "" "%APP_EXE%"
  exit /b 0
)

if exist "%PORTABLE_EXE%" (
  start "" "%PORTABLE_EXE%"
  exit /b 0
)

echo Could not find a runnable Dermatherapy Note Maker executable.
echo Try running npm install and then this launcher again.
pause
