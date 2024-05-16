# Stop script execution when a non-terminating error occurs
$ErrorActionPreference = "Stop"

& "$PSScriptRoot\prepare-windows-host.ps1"

Write-Host "--- :node: Building App"
node ./scripts/confirm-tag-matches-version.mjs
If ($LastExitCode -ne 0) { Exit $LastExitCode }

npm run make
If ($LastExitCode -ne 0) { Exit $LastExitCode }

