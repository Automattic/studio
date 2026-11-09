@echo off
setlocal enabledelayedexpansion

rem Save original code page
for /f "tokens=2 delims=:" %%i in ('chcp') do set "ORIGINAL_CP=%%i"
set ORIGINAL_CP=!ORIGINAL_CP: =!

rem Set code page to UTF-8
chcp 65001 >nul

set "INSTALL_DIR=%~dp0.."
set "RUNTIME_DIR=!INSTALL_DIR!"
if exist "!INSTALL_DIR!\cli\version" (
	set /p INSTALLED_VERSION=<"!INSTALL_DIR!\cli\version"
	set "CURRENT_FILE=!INSTALL_DIR!\cli-versions\current-!INSTALLED_VERSION!"
	if exist "!CURRENT_FILE!" (
		for /f "usebackq delims=" %%v in (`findstr /r /x "[0-9][0-9A-Za-z.+-]*" "!CURRENT_FILE!"`) do (
			if exist "!INSTALL_DIR!\cli-versions\%%v\bin\node.exe" if exist "!INSTALL_DIR!\cli-versions\%%v\cli\main.mjs" (
				set "RUNTIME_DIR=!INSTALL_DIR!\cli-versions\%%v"
			)
		)
	)
)
set "BUNDLED_NODE_EXECUTABLE=!RUNTIME_DIR!\bin\node.exe"
set "CLI_SCRIPT=!RUNTIME_DIR!\cli\main.mjs"

rem Prevent node from printing warnings about NODE_OPTIONS being ignored
set NODE_OPTIONS=

if exist "!BUNDLED_NODE_EXECUTABLE!" (
	"!BUNDLED_NODE_EXECUTABLE!" "!CLI_SCRIPT!" %*
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
