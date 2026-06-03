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

# --- Checksum verification ---

function Test-Checksum {
    param([string]$File, [string]$ChecksumFile)

    # Checksum file format: "<sha256>  <filename>"
    $Expected = ((Get-Content $ChecksumFile -Raw) -split '\s+')[0].ToLower()
    $Actual = (Get-FileHash -Path $File -Algorithm SHA256).Hash.ToLower()

    if ($Expected -ne $Actual) {
        throw "Checksum mismatch: expected $Expected, got $Actual"
    }
}

# --- Install ---

function Install-StudioCli {
    $Arch = Get-Platform
    $BinaryName = "studio-cli-win32-${Arch}.exe"
    $BinaryUrl = "${BaseUrl}/${BinaryName}"
    $SidecarUrl = "${BinaryUrl}.node_modules.tar.gz"

    Write-Host "Studio CLI Installer"
    Write-Host ""
    Write-Host "Detected platform: win32-$Arch"

    $BinDir = Join-Path $InstallDir "bin"
    New-Item -ItemType Directory -Path $BinDir -Force | Out-Null

    $BinaryPath = Join-Path $BinDir "studio.exe"
    $SidecarPath = "$BinaryPath.node_modules.tar.gz"

    # Download + verify in a staging dir, then move the verified files into
    # place. A failed or corrupt upgrade never clobbers a working install.
    $StagingDir = Join-Path $BinDir (".studio-install-" + [guid]::NewGuid().ToString("N"))
    New-Item -ItemType Directory -Path $StagingDir -Force | Out-Null
    try {
        $TmpBinary = Join-Path $StagingDir "studio.exe"
        $TmpBinaryChecksum = "$TmpBinary.sha256"
        $TmpSidecar = Join-Path $StagingDir "studio.exe.node_modules.tar.gz"
        $TmpSidecarChecksum = "$TmpSidecar.sha256"

        Write-Host "Downloading Studio CLI..."
        Get-Bundle -Url $BinaryUrl -Dest $TmpBinary
        Get-Bundle -Url "$BinaryUrl.sha256" -Dest $TmpBinaryChecksum
        Get-Bundle -Url $SidecarUrl -Dest $TmpSidecar
        Get-Bundle -Url "$SidecarUrl.sha256" -Dest $TmpSidecarChecksum

        Write-Host "Verifying checksum..."
        Test-Checksum -File $TmpBinary -ChecksumFile $TmpBinaryChecksum
        Test-Checksum -File $TmpSidecar -ChecksumFile $TmpSidecarChecksum

        # Move the verified files into place (replaces any existing install).
        # Sidecar first, binary last: if the second move fails, a still-old binary
        # keeps working with its already-extracted runtime, whereas a new binary
        # next to an old sidecar would re-extract a version-skewed runtime.
        Move-Item -Path $TmpSidecar -Destination $SidecarPath -Force
        Move-Item -Path $TmpBinary -Destination $BinaryPath -Force
    }
    finally {
        Remove-Item $StagingDir -Recurse -Force -ErrorAction SilentlyContinue
    }

    # Add to PATH — split on ';' for exact-entry match, not substring.
    $UserPath = [Environment]::GetEnvironmentVariable("PATH", "User")
    $PathDirs = @()
    if ($UserPath) {
        $PathDirs = $UserPath -split ';' | Where-Object { $_ -ne '' }
    }
    if ($PathDirs -notcontains $BinDir) {
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
