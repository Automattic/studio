@echo off
setlocal enabledelayedexpansion

rem Save original code page
for /f "tokens=2 delims=:" %%i in ('chcp') do set "ORIGINAL_CP=%%i"
set ORIGINAL_CP=!ORIGINAL_CP: =!

rem Set code page to UTF-8
chcp 65001 >nul

rem Layout under a Squirrel install:
rem   <root>\Studio.exe
rem   <root>\resources\bin\studio-cli.bat   <- this script
rem   <root>\resources\cli\main.mjs
set "STUDIO_EXE=%~dp0..\..\Studio.exe"
set "CLI_SCRIPT=%~dp0..\cli\main.mjs"

rem Prevent node from printing warnings about NODE_OPTIONS being ignored
set NODE_OPTIONS=

if exist "%STUDIO_EXE%" (
	set ELECTRON_RUN_AS_NODE=1
	"%STUDIO_EXE%" "!CLI_SCRIPT!" %*
	set ELECTRON_RUN_AS_NODE=
) else (
	if not exist "!CLI_SCRIPT!" (
		set "CLI_SCRIPT=%~dp0..\dist\cli\main.mjs"
	)
	node "!CLI_SCRIPT!" %*
)

set "EXIT_CODE=!ERRORLEVEL!"

rem Restore original code page
chcp !ORIGINAL_CP! >nul

endlocal
exit /b !EXIT_CODE!
