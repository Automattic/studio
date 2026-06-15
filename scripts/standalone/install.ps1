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
    $BundleName = "studio-cli-win32-${Arch}.tar.gz"
    $BundleUrl = "${BaseUrl}/${BundleName}"

    Write-Host "Studio CLI Installer"
    Write-Host ""
    Write-Host "Detected platform: win32-$Arch"

    New-Item -ItemType Directory -Path $InstallDir -Force | Out-Null
    $BinDir = Join-Path $InstallDir "bin"

    # Download, verify, and extract in a staging dir, then swap the runtime
    # dirs into place. A failed or corrupt download never clobbers a working
    # install.
    $StagingDir = Join-Path $InstallDir (".studio-install-" + [guid]::NewGuid().ToString("N"))
    New-Item -ItemType Directory -Path $StagingDir -Force | Out-Null
    try {
        $TmpBundle = Join-Path $StagingDir $BundleName

        Write-Host "Downloading Studio CLI..."
        Get-Bundle -Url $BundleUrl -Dest $TmpBundle
        Get-Bundle -Url "$BundleUrl.sha256" -Dest "$TmpBundle.sha256"

        Write-Host "Verifying checksum..."
        Test-Checksum -File $TmpBundle -ChecksumFile "$TmpBundle.sha256"

        Write-Host "Installing to $InstallDir..."
        $ExtractDir = Join-Path $StagingDir "extracted"
        New-Item -ItemType Directory -Path $ExtractDir -Force | Out-Null
        # Use the Windows-provided BSD tar explicitly: a GNU tar earlier on PATH
        # (e.g. Git Bash) would misread "C:" in the archive path as a remote host.
        & "$env:SystemRoot\System32\tar.exe" -xzf $TmpBundle -C $ExtractDir
        if ($LASTEXITCODE -ne 0) {
            throw "Failed to extract $BundleName (tar exited with $LASTEXITCODE)"
        }

        # A previous standalone install may have a running daemon and site
        # servers holding open handles on bin\node.exe and cli\. Windows blocks
        # removing files that are still open, so stop them first. Best-effort: a
        # missing or broken prior install shouldn't block the reinstall.
        $ExistingLauncher = Join-Path $BinDir "studio.cmd"
        if (Test-Path $ExistingLauncher) {
            Write-Host "Stopping running Studio sites and daemon..."
            try {
                & $ExistingLauncher site stop --all
            }
            catch {
            }
        }

        # Replace only the runtime dirs; anything else in $InstallDir is left
        # untouched.
        Remove-Item (Join-Path $InstallDir "cli") -Recurse -Force -ErrorAction SilentlyContinue
        Remove-Item $BinDir -Recurse -Force -ErrorAction SilentlyContinue
        Move-Item -Path (Join-Path $ExtractDir "cli") -Destination (Join-Path $InstallDir "cli")
        Move-Item -Path (Join-Path $ExtractDir "bin") -Destination $BinDir
    }
    finally {
        Remove-Item $StagingDir -Recurse -Force -ErrorAction SilentlyContinue
    }

    # Add to PATH — split on ';' for exact-entry match, not substring.
    # Read the raw registry value (DoNotExpandEnvironmentNames): the default
    # [Environment]::GetEnvironmentVariable expands %VAR% entries, and writing
    # the expanded result back would permanently break them for the user.
    $UserPath = ""
    $EnvKey = [Microsoft.Win32.Registry]::CurrentUser.OpenSubKey("Environment")
    if ($EnvKey) {
        $UserPath = [string]$EnvKey.GetValue("Path", "", [Microsoft.Win32.RegistryValueOptions]::DoNotExpandEnvironmentNames)
        $EnvKey.Close()
    }
    $PathDirs = $UserPath -split ';' | Where-Object { $_ -ne '' }
    if ($PathDirs -notcontains $BinDir) {
        $NewPath = if ($UserPath) { "$BinDir;$UserPath" } else { $BinDir }
        # SetEnvironmentVariable preserves %VAR% entries (values containing '%'
        # are written as REG_EXPAND_SZ) and broadcasts WM_SETTINGCHANGE so new
        # terminals pick up the change.
        [Environment]::SetEnvironmentVariable("PATH", $NewPath, "User")
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
