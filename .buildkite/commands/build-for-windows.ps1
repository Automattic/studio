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

Write-Host "--- :lock: Setting up Azure Trusted Signing"

# Verify required env vars
foreach ($var in @("AZURE_TENANT_ID", "AZURE_CLIENT_ID", "AZURE_CLIENT_SECRET", "AZURE_ENDPOINT", "AZURE_CODE_SIGNING_ACCOUNT", "AZURE_CERTIFICATE_PROFILE")) {
    if (-not (Test-Path "env:$var")) {
        Write-Host "Error: Required environment variable $var is not set" -ForegroundColor Red
        Exit 1
    }
}

# Install Azure Trusted Signing Client (provides the DLib DLL)
# NuGet packages are just zip files - download and extract directly.
Write-Host "~~~ Installing Microsoft.Trusted.Signing.Client NuGet package..."
$nugetDir = "$env:TEMP\AzureCodeSigning"
if (-not (Test-Path $nugetDir)) {
    New-Item -ItemType Directory -Path $nugetDir -Force | Out-Null
}
$nupkgUrl = "https://www.nuget.org/api/v2/package/Microsoft.Trusted.Signing.Client"
$nupkgPath = "$nugetDir\Microsoft.Trusted.Signing.Client.zip"
Invoke-WebRequest -Uri $nupkgUrl -OutFile $nupkgPath
Expand-Archive -Path $nupkgPath -DestinationPath "$nugetDir\Microsoft.Trusted.Signing.Client" -Force

$dlibPath = (Get-ChildItem -Path $nugetDir -Recurse -Filter "Azure.CodeSigning.Dlib.dll" | Where-Object { $_.FullName -like "*x64*" } | Select-Object -First 1).FullName
if (-not $dlibPath) {
    Write-Host "Error: Azure.CodeSigning.Dlib.dll not found" -ForegroundColor Red
    Exit 1
}
Write-Host "Found DLib at: $dlibPath"

# Azure Trusted Signing requires signtool from SDK 10.0.22621+.
# The CI agents have SDK 19041 which is too old (/dlib not supported).
# Download a modern signtool via the Microsoft.Windows.SDK.BuildTools NuGet package.
Write-Host "~~~ Installing modern signtool via Microsoft.Windows.SDK.BuildTools..."
$sdkToolsUrl = "https://www.nuget.org/api/v2/package/Microsoft.Windows.SDK.BuildTools"
$sdkToolsZip = "$nugetDir\Microsoft.Windows.SDK.BuildTools.zip"
$sdkToolsDir = "$nugetDir\Microsoft.Windows.SDK.BuildTools"
Invoke-WebRequest -Uri $sdkToolsUrl -OutFile $sdkToolsZip
Expand-Archive -Path $sdkToolsZip -DestinationPath $sdkToolsDir -Force
$signtoolPath = (Get-ChildItem -Path $sdkToolsDir -Recurse -Filter "signtool.exe" | Where-Object { $_.FullName -like "*x64*" } | Select-Object -First 1).FullName
if (-not $signtoolPath) {
    Write-Host "Error: signtool.exe not found in SDK BuildTools package" -ForegroundColor Red
    Exit 1
}
Write-Host "Found signtool at: $signtoolPath"

# Generate metadata.json for Azure Trusted Signing.
# Use the full resolved path to avoid 8.3 short names (e.g. BUILDK~1)
# which the Azure DLib may not handle.
$metadataPath = [System.IO.Path]::Combine([System.IO.Path]::GetFullPath($env:TEMP), "metadata.json")
$metadata = @{
    Endpoint = $env:AZURE_ENDPOINT
    CodeSigningAccountName = $env:AZURE_CODE_SIGNING_ACCOUNT
    CertificateProfileName = $env:AZURE_CERTIFICATE_PROFILE
    ExcludeCredentials = @(
        "ManagedIdentityCredential"
        "WorkloadIdentityCredential"
        "SharedTokenCacheCredential"
        "VisualStudioCredential"
        "VisualStudioCodeCredential"
        "AzureCliCredential"
        "AzurePowerShellCredential"
        "AzureDeveloperCliCredential"
        "InteractiveBrowserCredential"
    )
} | ConvertTo-Json
Set-Content -Path $metadataPath -Value $metadata
Write-Host "Generated metadata.json at: $metadataPath"

# Export paths as env vars for forge and package-appx to consume
$env:AZURE_CODE_SIGNING_DLIB = $dlibPath
$env:AZURE_METADATA_JSON = $metadataPath
$env:SIGNTOOL_PATH = $signtoolPath
$env:AZURE_FILE_DIGEST = "SHA256"
$env:AZURE_TIMESTAMP_DIGEST = "SHA256"
$env:AZURE_TIMESTAMP_SERVER = "http://timestamp.acs.microsoft.com"

# The DLib is a .NET assembly (C++/CLI via Ijwhost.dll) that requires the .NET runtime.
# Check if .NET 6+ is available; install if missing.
Write-Host "~~~ Checking .NET runtime..."
$dotnetRuntimes = $null
try { $dotnetRuntimes = & dotnet --list-runtimes 2>&1 } catch {}

$hasNet6Plus = $dotnetRuntimes | Where-Object { $_ -match "Microsoft\.NETCore\.App\s+([6-9]|[1-9]\d+)\." } | Select-Object -First 1
if (-not $hasNet6Plus) {
    Write-Host "Installing .NET 8 Runtime..."
    $dotnetInstallScript = "$env:TEMP\dotnet-install.ps1"
    Invoke-WebRequest -Uri "https://dot.net/v1/dotnet-install.ps1" -OutFile $dotnetInstallScript
    & $dotnetInstallScript -Runtime dotnet -Channel 8.0 -InstallDir "$env:ProgramFiles\dotnet"
    $env:PATH = "$env:ProgramFiles\dotnet;$env:PATH"
}

# Smoke test: sign a dummy file to verify Azure auth before the full build
Write-Host "~~~ Smoke testing Azure Trusted Signing..."
$dummyExe = "$env:TEMP\signing-test.exe"
Copy-Item "C:\Windows\System32\cmd.exe" $dummyExe -Force

$outFile = "$env:TEMP\signtool-out.txt"
cmd /c "`"$signtoolPath`" sign /v /fd $env:AZURE_FILE_DIGEST /tr $env:AZURE_TIMESTAMP_SERVER /td $env:AZURE_TIMESTAMP_DIGEST /dlib `"$dlibPath`" /dmdf `"$metadataPath`" `"$dummyExe`" > `"$outFile`" 2>&1"
$signtoolExitCode = $LastExitCode
Get-Content $outFile
Remove-Item $outFile -ErrorAction SilentlyContinue

If ($signtoolExitCode -ne 0) {
    Write-Host "Error: Smoke test failed (exit code $signtoolExitCode)" -ForegroundColor Red
    Exit 1
}
Write-Host "Smoke test passed."
Remove-Item $dummyExe -Force

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
