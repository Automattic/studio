# Stop script execution when a non-terminating error occurs
$ErrorActionPreference = "Stop"

# TODO: This needs to be read by other files. Extract in a shared location.
$windows10SDKVersion = "20348"

Write-Host "--- :wrench: Setting up Windows 10 ($windows10SDKVersion) SDK and Visual Studio Build Tools"

# Download the Visual Studio Build Tools Bootstrapper
Write-Output "Downloading Visual Studio Build Tools..."
Invoke-WebRequest -Uri https://aka.ms/vs/17/release/vs_buildtools.exe -OutFile vs_buildtools.exe
If (-not (Test-Path .\vs_buildtools.exe)) {
    Write-Output "[!] Failed to download Visual Studio Build Tools"
    Exit 1
}

# Install the Windows SDK and other required components
Write-Output "Installing Visual Studio Build Tools..."
Start-Process -FilePath .\vs_buildtools.exe -ArgumentList "--quiet --wait --add Microsoft.VisualStudio.Component.Windows10SDK.$windows10SDKVersion" -NoNewWindow -Wait

# Check if the installation was successful in file system
$windowsSDKsRoot = "C:\Program Files (x86)\Windows Kits\10\bin"
$sdkPath = "$windowsSDKsRoot\10.0.$windows10SDKVersion.0\x64"
If (-not (Test-Path $sdkPath)) {
    Write-Output "[!] Failed to install Windows 10 SDK: Could not find SDK at $sdkPath."
    If (-not (Test-Path $windowsSDKsRoot)) {
        Write-Output "[!] Expected $windowsSDKsRoot to exist, but it does not."
    } else {
        Write-Output "    Found:"
        Get-ChildItem -Path $windowsSDKsRoot | ForEach-Object { Write-Output "    - $windowsSDKsRoot\$_" }
    }
    Exit 1
}

Write-Output "Visual Studio Build Tools + Windows 10 ($windows10SDKVersion) SDK installation completed. SDK path: $sdkPath."

Write-Output "Cleaning up..."
Remove-Item -Path .\vs_buildtools.exe
Write-Output "Done"
