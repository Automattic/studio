# Stop script execution when a non-terminating error occurs
$ErrorActionPreference = "Stop"

& "prepare_windows_host_for_app_distribution.ps1" # via CI toolkit plugin

Write-Host "--- :node: Building App"
node ./scripts/prepare-dev-build-version.mjs
If ($LastExitCode -ne 0) { Exit $LastExitCode }

$env:IS_DEV_BUILD="true"
npm run make

# Rename NuGet package files with generic name
$artifactsPath = Get-Item ".\out" | Select-Object -ExpandProperty FullName
Get-ChildItem -Path $artifactsPath -Recurse -Include "*.nupkg" | Rename-Item -NewName "studio-update.nupkg"

If ($LastExitCode -ne 0) { Exit $LastExitCode }
