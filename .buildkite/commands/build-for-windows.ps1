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

$useAzureTrustedSigning = "$($env:USE_AZURE_TRUSTED_SIGNING)".Trim().ToLower()
If (@('1', 'true') -contains $useAzureTrustedSigning) {
    Write-Host "--- :lock: Setting up Azure Trusted Signing"
    $setupScript = (Get-Command setup_azure_trusted_signing.ps1 -ErrorAction Stop).Source
    & $setupScript
    If ($LastExitCode -ne 0) { Exit $LastExitCode }
} Else {
    # setup_windows_code_signing.ps1 comes from CI Toolkit Plugin
    & "setup_windows_code_signing.ps1"
    If ($LastExitCode -ne 0) { Exit $LastExitCode }
}

Write-Host "--- :windows: Enabling long path support"
New-ItemProperty -Path "HKLM:\SYSTEM\CurrentControlSet\Control\FileSystem" `
    -Name "LongPathsEnabled" -Value 1 -PropertyType DWORD -Force
If ($LastExitCode -ne 0) { Exit $LastExitCode }

Write-Host "--- :npm: Installing Node dependencies"
bash .buildkite/commands/install-node-dependencies.sh
If ($LastExitCode -ne 0) { Exit $LastExitCode }

# The bundled nuget.exe in electron-winstaller is v4.0 which predates long-path support (requires
# v4.8+). Replace it with the latest stable release so the LongPathsEnabled registry key above
# actually takes effect during `npm run make`.
Write-Host "--- :nuget: Upgrading bundled nuget.exe to latest (long-path support requires >= 4.8)"
$nugetVendorPath = "node_modules\electron-winstaller\vendor\nuget.exe"
Invoke-WebRequest -Uri "https://dist.nuget.org/win-x86-commandline/latest/nuget.exe" `
    -OutFile $nugetVendorPath -UseBasicParsing
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
}

# Set architecture environment variable for AppX packaging
$env:FILE_ARCHITECTURE=$Architecture

Write-Host "Building for architecture: $Architecture"
npm -w studio-app run "make:windows-$Architecture"
If ($LastExitCode -ne 0) { Exit $LastExitCode }

# Rename NuGet package files with generic name
$artifactsPath = Get-Item ".\apps\studio\out" | Select-Object -ExpandProperty FullName
Get-ChildItem -Path $artifactsPath -Recurse -Include "*.nupkg" | Rename-Item -NewName "studio-update.nupkg"
If ($LastExitCode -ne 0) { Exit $LastExitCode }

Write-Host "--- :package: Building AppX package"
node scripts/package-appx.mjs
If ($LastExitCode -ne 0) { Exit $LastExitCode }
