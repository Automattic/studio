@echo off
setlocal enabledelayedexpansion

rem Save original code page
for /f "tokens=2 delims=:" %%i in ('chcp') do set "ORIGINAL_CP=%%i"
set ORIGINAL_CP=!ORIGINAL_CP: =!

rem Set code page to UTF-8
chcp 65001 >nul

set BUNDLED_NODE_EXECUTABLE=%~dp0node.exe
set "CLI_SCRIPT=%~dp0..\cli\main.mjs"

rem Prevent node from printing warnings about NODE_OPTIONS being ignored
set NODE_OPTIONS=

if exist "%BUNDLED_NODE_EXECUTABLE%" (
	"!BUNDLED_NODE_EXECUTABLE!" --experimental-wasm-jspi "!CLI_SCRIPT!" %*
) else (
	if not exist "!CLI_SCRIPT!" (
		set "CLI_SCRIPT=%~dp0..\dist\cli\main.mjs"
	)
	node --experimental-wasm-jspi "!CLI_SCRIPT!" %*
)

set "EXIT_CODE=!ERRORLEVEL!"

rem Restore original code page
chcp !ORIGINAL_CP! >nul

endlocal
exit /b !EXIT_CODE!
