# Accept a parameter to determine build type (required)
param (
    [Parameter(Mandatory=$true)]
    [string]$BuildType
)

# Stop script execution when a non-terminating error occurs
$ErrorActionPreference = "Stop"

# Define constants for build types
$BUILD_TYPE_DEV = "dev"
$BUILD_TYPE_RELEASE = "release"
$VALID_BUILD_TYPES = @($BUILD_TYPE_DEV, $BUILD_TYPE_RELEASE)

# Validate build type
if ($BuildType -notin $VALID_BUILD_TYPES) {
    Write-Host "Error: BuildType must be one of: $($VALID_BUILD_TYPES -join ', ')" -ForegroundColor Red
    Exit 1
}

Write-Host "--- :npm: Installing Node dependencies"
bash .buildkite/commands/install-node-dependencies.sh

& "prepare_windows_host_for_app_distribution.ps1" # via CI toolkit plugin

Write-Host "--- :node: Building App for Windows ($BuildType)"

# Run appropriate script based on build type
if ($BuildType -eq $BUILD_TYPE_DEV) {
    Write-Host "Preparing dev build..."
    node ./scripts/prepare-dev-build-version.mjs
    $env:IS_DEV_BUILD="true"
} else {
    Write-Host "Preparing release build..."
    node ./scripts/confirm-tag-matches-version.mjs
}

If ($LastExitCode -ne 0) { Exit $LastExitCode }

npm run make

# Rename NuGet package files with generic name
$artifactsPath = Get-Item ".\out" | Select-Object -ExpandProperty FullName
Get-ChildItem -Path $artifactsPath -Recurse -Include "*.nupkg" | Rename-Item -NewName "studio-update.nupkg"

If ($LastExitCode -ne 0) { Exit $LastExitCode }

Write-Host "--- :package: Building AppX package"
node scripts/package-appx.mjs

If ($LastExitCode -ne 0) { Exit $LastExitCode }
