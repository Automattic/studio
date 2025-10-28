# Accept parameters to determine build type and architecture
param (
    [Parameter(Mandatory=$true)]
    [string]$BuildType,
    
    [Parameter(Mandatory=$false)]
    [string]$Architecture = "x64"
)

# Stop script execution when a non-terminating error occurs
$ErrorActionPreference = "Stop"

# Define constants for build types
$BUILD_TYPE_DEV = "dev"
$BUILD_TYPE_RELEASE = "release"
$VALID_BUILD_TYPES = @($BUILD_TYPE_DEV, $BUILD_TYPE_RELEASE)
$VALID_ARCHITECTURES = @("x64", "arm64")

# Validate build type
if ($BuildType -notin $VALID_BUILD_TYPES) {
    Write-Host "Error: BuildType must be one of: $($VALID_BUILD_TYPES -join ', ')" -ForegroundColor Red
    Exit 1
}

# Validate architecture
if ($Architecture -notin $VALID_ARCHITECTURES) {
    Write-Host "Error: Architecture must be one of: $($VALID_ARCHITECTURES -join ', ')" -ForegroundColor Red
    Exit 1
}

# TEMPORARY – install Python via PowerShell until this is baked into the image
$ver = "3.13.9"

# Map architecture to the correct filename suffix
switch ($Architecture.ToLower()) {
    "x64"   { $archSuffix = "amd64" }
    "arm64" { $archSuffix = "arm64" }
    default { throw "Unsupported architecture: $VALID_ARCHITECTURES" }
}

# Construct download URL
$uri = "https://cdn.a8c-ci.services/studio/python-$ver-$archSuffix.exe"
$dst = "$env:TEMP\python-$ver-$archSuffix.exe"

Write-Host "Downloading Python $ver for $archSuffix from $uri..."
Invoke-WebRequest -Uri $uri -OutFile $dst

# Verify publisher signature
$sig = Get-AuthenticodeSignature $dst
if ($sig.Status -ne 'Valid') { throw "Installer signature not valid: $($sig.Status)" }

# Silent install for all users; add to PATH; skip tests
Start-Process -FilePath $dst -ArgumentList "/quiet InstallAllUsers=1 PrependPath=1 Include_test=0" -Wait
Write-Host "Python installation complete."

# prepare_windows_host_for_app_distribution.ps1 comes from CI Toolkit Plugin
& "prepare_windows_host_for_app_distribution.ps1" -InstallNativeCompilationTools $true
If ($LastExitCode -ne 0) { Exit $LastExitCode }

Write-Host "--- :npm: Installing Node dependencies"
bash .buildkite/commands/install-node-dependencies.sh
If ($LastExitCode -ne 0) { Exit $LastExitCode }

Write-Host "--- :node: Building App for Windows ($BuildType - $Architecture)"

# Run appropriate script based on build type
if ($BuildType -eq $BUILD_TYPE_DEV) {
    Write-Host "Preparing dev build..."
    node ./scripts/prepare-dev-build-version.mjs
	If ($LastExitCode -ne 0) { Exit $LastExitCode }
    $env:IS_DEV_BUILD="true"
} else {
    Write-Host "Preparing release build..."
    node ./scripts/confirm-tag-matches-version.mjs
	If ($LastExitCode -ne 0) { Exit $LastExitCode }
}

# Set architecture environment variable for AppX packaging
$env:FILE_ARCHITECTURE=$Architecture

Write-Host "Building for architecture: $Architecture"
npm run "make:windows-$Architecture"
If ($LastExitCode -ne 0) { Exit $LastExitCode }

# Rename NuGet package files with generic name
$artifactsPath = Get-Item ".\out" | Select-Object -ExpandProperty FullName
Get-ChildItem -Path $artifactsPath -Recurse -Include "*.nupkg" | Rename-Item -NewName "studio-update.nupkg"
If ($LastExitCode -ne 0) { Exit $LastExitCode }

Write-Host "--- :package: Building AppX package"
node scripts/package-appx.mjs
If ($LastExitCode -ne 0) { Exit $LastExitCode }
