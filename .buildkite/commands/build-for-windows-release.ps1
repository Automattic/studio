# Stop script execution when a non-terminating error occurs
$ErrorActionPreference = "Stop"

npm run make
If ($LastExitCode -ne 0) { Exit $LastExitCode }

