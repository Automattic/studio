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
    $BinaryName = "studio-cli-win32-${Arch}.exe"
    $BinaryUrl = "${BaseUrl}/${BinaryName}"

    Write-Host "Studio CLI Installer"
    Write-Host ""
    Write-Host "Detected platform: win32-$Arch"

    # Download
    Write-Host "Downloading Studio CLI..."
    $BinDir = Join-Path $InstallDir "bin"
    New-Item -ItemType Directory -Path $BinDir -Force | Out-Null
    Get-Bundle -Url $BinaryUrl -Dest (Join-Path $BinDir "studio.exe")

    # Add to PATH
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
