@echo off
setlocal enabledelayedexpansion

rem Studio CLI standalone launcher for Windows
rem Layout: INSTALL_DIR\bin\studio.cmd (this script), INSTALL_DIR\bin\node.exe, INSTALL_DIR\cli\main.mjs

rem Save original code page and set to UTF-8
for /f "tokens=2 delims=:" %%i in ('chcp') do set "ORIGINAL_CP=%%i"
set ORIGINAL_CP=!ORIGINAL_CP: =!
chcp 65001 >nul

set "BIN_DIR=%~dp0"
rem Remove trailing backslash and go up one level
set "BIN_DIR=%BIN_DIR:~0,-1%"
for %%i in ("%BIN_DIR%") do set "INSTALL_DIR=%%~dpi"
set "INSTALL_DIR=%INSTALL_DIR:~0,-1%"

set "NODE_EXECUTABLE=%BIN_DIR%\node.exe"
set "CLI_SCRIPT=%INSTALL_DIR%\cli\main.mjs"

if not exist "%NODE_EXECUTABLE%" (
	echo Error: Bundled Node.js not found at %NODE_EXECUTABLE% >&2
	echo Reinstall with: irm https://wp.build/install.ps1 ^| iex >&2
	chcp !ORIGINAL_CP! >nul
	exit /b 1
)

if not exist "%CLI_SCRIPT%" (
	echo Error: CLI entry point not found at %CLI_SCRIPT% >&2
	chcp !ORIGINAL_CP! >nul
	exit /b 1
)

rem Prevent node from printing warnings about NODE_OPTIONS being ignored
set NODE_OPTIONS=

"%NODE_EXECUTABLE%" --experimental-wasm-jspi "%CLI_SCRIPT%" %*

set "EXIT_CODE=!ERRORLEVEL!"
chcp !ORIGINAL_CP! >nul
endlocal & exit /b %EXIT_CODE%
