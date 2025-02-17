# Stop script execution when a non-terminating error occurs
$ErrorActionPreference = "Stop"

& "prepare_windows_host_for_node.ps1"
If ($LastExitCode -ne 0) { Exit $LastExitCode }

bash "$PSScriptRoot\install-node-dependencies.sh"
If ($LastExitCode -ne 0) { Exit $LastExitCode }
