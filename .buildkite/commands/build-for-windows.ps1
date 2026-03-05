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

# Read Windows SDK version for signtool path
$sdkVersion = (Get-Content ".windows-10-sdk-version").Trim()
$signtoolPath = "C:\Program Files (x86)\Windows Kits\10\bin\10.0.$sdkVersion.0\x64\signtool.exe"
if (-not (Test-Path $signtoolPath)) {
    Write-Host "Error: signtool.exe not found at $signtoolPath" -ForegroundColor Red
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
Write-Host "metadata.json contents:"
Get-Content $metadataPath

# Verify Azure auth env vars are visible to child processes
Write-Host "AZURE_TENANT_ID is set: $(-not [string]::IsNullOrEmpty($env:AZURE_TENANT_ID))"
Write-Host "AZURE_CLIENT_ID is set: $(-not [string]::IsNullOrEmpty($env:AZURE_CLIENT_ID))"
Write-Host "AZURE_CLIENT_SECRET is set: $(-not [string]::IsNullOrEmpty($env:AZURE_CLIENT_SECRET))"

# Export paths as env vars for forge and package-appx to consume
$env:AZURE_CODE_SIGNING_DLIB = $dlibPath
$env:AZURE_METADATA_JSON = $metadataPath
$env:SIGNTOOL_PATH = $signtoolPath

# Smoke test: sign a small dummy file to verify Azure auth works before the full build
Write-Host "~~~ Smoke testing Azure Trusted Signing..."
$dummyExe = "$env:TEMP\signing-test.exe"
# Create a minimal valid PE file (copy cmd.exe as a test subject)
Copy-Item "C:\Windows\System32\cmd.exe" $dummyExe -Force
& $signtoolPath sign /v /debug /fd SHA256 /tr http://timestamp.acs.microsoft.com /td SHA256 /dlib $dlibPath /dmdf $metadataPath $dummyExe
If ($LastExitCode -ne 0) {
    Write-Host "Error: Azure Trusted Signing smoke test failed!" -ForegroundColor Red
    Write-Host "signtool path: $signtoolPath"
    Write-Host "dlib path: $dlibPath"
    Write-Host "metadata path: $metadataPath"
    Write-Host "metadata contents:"
    Get-Content $metadataPath
    Exit 1
}
Write-Host "Smoke test passed - Azure Trusted Signing is working."
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
