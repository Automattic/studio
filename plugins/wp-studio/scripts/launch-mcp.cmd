@echo off
rem launch-mcp for Windows, where Codex runs this file for ./scripts/launch-mcp.
rem It starts bootstrap-mcp.mjs with the Node.js of the ChatGPT app's Codex
rem runtime, recent enough to run a CLI the plugin carries, then with the one on
rem PATH. Without either, it uses the Node.js the Studio CLI installer brings,
rem installing the CLI first.
rem
rem stdout carries the MCP messages: anything else must go to stderr.
setlocal

set "INSTALLER_URL=%STUDIO_INSTALLER_URL%"
if not defined INSTALLER_URL set "INSTALLER_URL=https://wordpress.studio/install.ps1"
set "STUDIO_NODE_EXE=%LOCALAPPDATA%\studio\bin\node.exe"
if defined STUDIO_CLI_HOME set "STUDIO_NODE_EXE=%STUDIO_CLI_HOME%\bin\node.exe"
set "RUNTIME_NODE=%USERPROFILE%\.cache\codex-runtimes\codex-primary-runtime\dependencies\node"

set "NODE=%STUDIO_NODE%"
if not defined NODE if exist "%RUNTIME_NODE%\node.exe" set "NODE=%RUNTIME_NODE%\node.exe"
if not defined NODE if exist "%RUNTIME_NODE%\bin\node.exe" set "NODE=%RUNTIME_NODE%\bin\node.exe"
if not defined NODE for /f "delims=" %%n in ('where node 2^>nul') do if not defined NODE set "NODE=%%n"
if not defined NODE if not exist "%STUDIO_NODE_EXE%" (
	echo WordPress Studio CLI not found: installing it ^(a download of about 260 MB^)... 1>&2
	powershell.exe -NoProfile -Command "irm '%INSTALLER_URL%' | iex" 1>&2
)
if not defined NODE set "NODE=%STUDIO_NODE_EXE%"
if not exist "%NODE%" (
	echo Could not install the WordPress Studio CLI. Install it with `irm https://wordpress.studio/install.ps1 ^| iex` in PowerShell and start a new session. 1>&2
	exit /b 1
)

"%NODE%" "%~dp0bootstrap-mcp.mjs"
