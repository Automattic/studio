@echo off
setlocal enabledelayedexpansion

rem Save original code page
for /f "tokens=2 delims=:" %%i in ('chcp') do set "ORIGINAL_CP=%%i"
set ORIGINAL_CP=!ORIGINAL_CP: =!

rem Set code page to UTF-8
chcp 65001 >nul 2>&1

set "ELECTRON_EXECUTABLE=%~dp0..\..\Studio.exe"
set "CLI_SCRIPT=%~dp0..\cli\main.js"

rem Prevent node from printing warnings about NODE_OPTIONS being ignored
set NODE_OPTIONS=

if exist "!ELECTRON_EXECUTABLE!" (
    set ELECTRON_RUN_AS_NODE=1
    "!ELECTRON_EXECUTABLE!" "!CLI_SCRIPT!" %*
) else (
    if not exist "!CLI_SCRIPT!" (
        set "CLI_SCRIPT=%~dp0..\dist\cli\main.js"
    )
    node "!CLI_SCRIPT!" %*
)

set "EXIT_CODE=!ERRORLEVEL!"

rem Restore original code page
chcp !ORIGINAL_CP! >nul 2>&1

endlocal
exit /b !EXIT_CODE!
