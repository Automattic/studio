@echo off
rem launch-mcp for Windows, where Codex runs this file for ./scripts/launch-mcp.
rem It starts bootstrap-mcp.mjs with the Node.js of the ChatGPT app's Codex
rem runtime, recent enough to run the Studio CLI the plugin carries, then with
rem the one on PATH. Without a Node.js, it runs an installed Studio CLI directly.
rem
rem stdout carries the MCP messages: anything else must go to stderr.
setlocal

set "RUNTIME_NODE=%USERPROFILE%\.cache\codex-runtimes\codex-primary-runtime\dependencies\node"
set "NODE=%STUDIO_NODE%"
if not defined NODE if exist "%RUNTIME_NODE%\node.exe" set "NODE=%RUNTIME_NODE%\node.exe"
if not defined NODE if exist "%RUNTIME_NODE%\bin\node.exe" set "NODE=%RUNTIME_NODE%\bin\node.exe"
if not defined NODE for /f "delims=" %%n in ('where node 2^>nul') do if not defined NODE set "NODE=%%n"
if defined NODE (
	"%NODE%" "%~dp0bootstrap-mcp.mjs"
	exit /b
)

for /f "delims=" %%s in ('where studio 2^>nul') do (
	call "%%s" mcp
	exit /b
)

echo WordPress Studio needs Node.js 22 or later, or the Studio desktop app. 1>&2
exit /b 1
