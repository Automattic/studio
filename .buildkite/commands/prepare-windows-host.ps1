# Stop script execution when a non-terminating error occurs
$ErrorActionPreference = "Stop"

Write-Host "--- :windows: Setting up Windows"
& "prepare_windows_host_for_node.ps1"
If ($LastExitCode -ne 0) { Exit $LastExitCode }

# Building AppX requires the Windows 10 SDK
#
# See https://github.com/hermit99/electron-windows-store/tree/v2.1.2?tab=readme-ov-file#usage
& "install_windows_10_sdk.ps1"
If ($LastExitCode -ne 0) { Exit $LastExitCode }

Write-Host "--- :npm: Installing Node dependencies"
npm ci
If ($LastExitCode -ne 0) { Exit $LastExitCode }
