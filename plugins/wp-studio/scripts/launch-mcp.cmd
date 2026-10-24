@echo off
rem launch-mcp for Windows, where Codex runs this file for ./scripts/launch-mcp.
rem It starts bootstrap-mcp.mjs with the Node.js the ChatGPT app gives plugins,
rem or the one of its Codex runtime, recent enough to run the Studio CLI the
rem plugin carries, then with the one on PATH. Without a Node.js, it runs an
rem installed Studio CLI directly. With `hook`, it runs the plugin's hooks on the
rem agent's own file tools (hooks/hooks.json), which need a Node.js.
rem
rem stdout carries the MCP messages: anything else must go to stderr.
setlocal

set "RUNTIME_NODE=%USERPROFILE%\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe"
set "NODE=%STUDIO_NODE%"
if not defined NODE if exist "%CODEX_MCP_NODE_PATH%" set "NODE=%CODEX_MCP_NODE_PATH%"
if not defined NODE if exist "%RUNTIME_NODE%" set "NODE=%RUNTIME_NODE%"
if not defined NODE for /f "delims=" %%n in ('where node 2^>nul') do if not defined NODE set "NODE=%%n"
if defined NODE (
	"%NODE%" "%~dp0bootstrap-mcp.mjs" %*
	exit /b
)
if "%~1"=="hook" exit /b 0

for /f "delims=" %%s in ('where studio 2^>nul') do (
	call "%%s" mcp
	exit /b
)

echo WordPress Studio needs Node.js 22 or later, or the Studio desktop app. 1>&2
exit /b 1
