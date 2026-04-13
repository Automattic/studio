# Studio CLI installer for Windows
# Usage: irm https://wp.build/install.ps1 | iex
#
# Environment variables:
#   STUDIO_CLI_HOME — Installation directory (default: %LOCALAPPDATA%\studio)
#   STUDIO_CLI_URL  — Base URL for downloading bundles (default: https://wp.build/releases)

$ErrorActionPreference = "Stop"

$InstallDir = if ($env:STUDIO_CLI_HOME) { $env:STUDIO_CLI_HOME } else { "$env:LOCALAPPDATA\studio" }
$BaseUrl = if ($env:STUDIO_CLI_URL) { $env:STUDIO_CLI_URL } else { "https://wp.build/releases" }

# --- Platform detection ---

function Get-Platform {
    if ($env:PROCESSOR_ARCHITECTURE -eq "ARM64" -or $env:PROCESSOR_ARCHITEW6432 -eq "ARM64") {
        return "arm64"
    }
    return "x64"
}

# --- Download ---

function Get-Bundle {
    param([string]$Url, [string]$Dest)

    # Support local file paths for testing
    if (Test-Path $Url -ErrorAction SilentlyContinue) {
        Copy-Item $Url -Destination $Dest
        return
    }

    $ProgressPreference = "SilentlyContinue"
    Invoke-WebRequest -Uri $Url -OutFile $Dest -UseBasicParsing
}

# --- Install ---

function Install-StudioCli {
    $Arch = Get-Platform
    $BundleName = "studio-cli-win32-${Arch}.zip"
    $BundleUrl = "${BaseUrl}/${BundleName}"
    $TmpDir = Join-Path $env:TEMP "studio-cli-install"

    Write-Host "Studio CLI Installer"
    Write-Host ""
    Write-Host "Detected platform: win32-$Arch"

    # Download
    Write-Host "Downloading Studio CLI..."
    if (Test-Path $TmpDir) { Remove-Item $TmpDir -Recurse -Force }
    New-Item -ItemType Directory -Path $TmpDir -Force | Out-Null
    Get-Bundle -Url $BundleUrl -Dest "$TmpDir\$BundleName"

    # Extract to temp location, then replace only bin/ and cli/
    # to preserve existing config files (cli.json, shared.json, certificates, etc.)
    Write-Host "Installing to $InstallDir..."
    $ExtractDir = Join-Path $env:TEMP "studio-cli-extract"
    if (Test-Path $ExtractDir) { Remove-Item $ExtractDir -Recurse -Force }
    New-Item -ItemType Directory -Path $ExtractDir -Force | Out-Null
    Expand-Archive -Path "$TmpDir\$BundleName" -DestinationPath $ExtractDir -Force

    # Move contents from nested directory
    $NestedDir = Get-ChildItem $ExtractDir -Directory | Select-Object -First 1
    if ($NestedDir) {
        Get-ChildItem $NestedDir.FullName | Move-Item -Destination $ExtractDir -Force
        Remove-Item $NestedDir.FullName -Recurse -Force
    }

    # Replace only bin/ and cli/, preserving config
    New-Item -ItemType Directory -Path $InstallDir -Force | Out-Null
    foreach ($dir in @("bin", "cli")) {
        $dest = Join-Path $InstallDir $dir
        if (Test-Path $dest) { Remove-Item $dest -Recurse -Force }
        Move-Item (Join-Path $ExtractDir $dir) -Destination $dest -Force
    }
    Remove-Item $ExtractDir -Recurse -Force

    # Cleanup
    Remove-Item $TmpDir -Recurse -Force

    # Add to PATH
    $BinDir = Join-Path $InstallDir "bin"
    $UserPath = [Environment]::GetEnvironmentVariable("PATH", "User")
    if ($UserPath -notlike "*$BinDir*") {
        [Environment]::SetEnvironmentVariable("PATH", "$BinDir;$UserPath", "User")
        $env:PATH = "$BinDir;$env:PATH"
        Write-Host "Added $BinDir to user PATH"
    }

    Write-Host ""
    Write-Host "Studio CLI installed successfully!"
    Write-Host ""
    Write-Host "  Restart your terminal, then run 'studio --help' to get started"
    Write-Host ""
}

Install-StudioCli
