# Stop script execution when a non-terminating error occurs
$ErrorActionPreference = "Stop"

& "prepare_windows_host_for_node.ps1"
If ($LastExitCode -ne 0) { Exit $LastExitCode }

Write-Host "--- :npm: Installing Node dependencies"
npm ci
If ($LastExitCode -ne 0) { Exit $LastExitCode }
