@echo off
setlocal

rem Save original code page
for /f "tokens=2 delims=:" %%i in ('chcp') do set "ORIGINAL_CP=%%i"
set ORIGINAL_CP=%ORIGINAL_CP: =%

rem Set code page to UTF-8
chcp 65001 >nul

set ELECTRON_RUN_AS_NODE=1
call "%~dp0..\..\Studio.exe" "%~dp0..\cli\main.js" %*

rem Restore original code page
chcp %ORIGINAL_CP% >nul

endlocal
