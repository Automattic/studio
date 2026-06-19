# Studio CLI installer for Windows
#
# Usage (production): irm https://wp.build/install.ps1 | iex
#   Piping to `iex` runs the script as an expression, so PowerShell's execution
#   policy doesn't apply.
#
# Running the .ps1 file directly is gated by the execution policy, so for local
# testing pass -ExecutionPolicy Bypass:
#   powershell -ExecutionPolicy Bypass -File scripts\standalone\install.ps1
#
# Environment variables:
#   STUDIO_CLI_HOME     — Installation directory (default: %LOCALAPPDATA%\studio)
#   STUDIO_CLI_VERSION  — Version to install from the CDN (default: latest, e.g. v1.11.0)
#   STUDIO_CLI_URL      — Override the download source with a base URL or local dir,
#                         bypassing the CDN. Expects studio-cli-<platform>-<arch>.tgz
#                         (used for testing and mirrors).

$ErrorActionPreference = "Stop"

$InstallDir = if ($env:STUDIO_CLI_HOME) { $env:STUDIO_CLI_HOME } else { "$env:LOCALAPPDATA\studio" }
$CdnBase = "https://appscdn.wordpress.com/downloads/wordpress-com-studio-cli"
$CdnVersion = if ($env:STUDIO_CLI_VERSION) { $env:STUDIO_CLI_VERSION } else { "latest" }

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
    $BundleName = "studio-cli-win32-${Arch}.tgz"

    # Default to the Apps CDN, which 302-redirects "latest" (or a pinned version) to
    # the newest published bundle. STUDIO_CLI_URL overrides this with a base URL or
    # local dir that serves the bundle by name — used for local testing, mirrors, or
    # pinning an arbitrary build.
    if ($env:STUDIO_CLI_URL) {
        $BundleUrl = "$($env:STUDIO_CLI_URL)/${BundleName}"
    }
    else {
        $Slug = if ($Arch -eq "arm64") { "windows-arm64" } else { "windows-x64" }
        $BundleUrl = "${CdnBase}/${Slug}/${CdnVersion}/full-install"
    }

    Write-Host "Studio CLI Installer"
    Write-Host ""
    Write-Host "Detected platform: win32-$Arch"

    New-Item -ItemType Directory -Path $InstallDir -Force | Out-Null
    $BinDir = Join-Path $InstallDir "bin"

    # Download and extract in a staging dir, then swap the runtime dirs into place.
    # A failed, corrupt, or truncated download fails at extraction below and never
    # clobbers a working install.
    $StagingDir = Join-Path $InstallDir (".studio-install-" + [guid]::NewGuid().ToString("N"))
    New-Item -ItemType Directory -Path $StagingDir -Force | Out-Null
    try {
        $TmpBundle = Join-Path $StagingDir $BundleName

        Write-Host "Downloading Studio CLI..."
        Get-Bundle -Url $BundleUrl -Dest $TmpBundle

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
