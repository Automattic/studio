@echo off
setlocal

set ELECTRON_RUN_AS_NODE=1
call "%~dp0..\..\..\Studio.exe" "%~dp0..\cli\index.js" %*

endlocal 