# Stop script execution when a non-terminating error occurs
$ErrorActionPreference = "Stop"

# From https://stackoverflow.com/a/46760714
Write-Output "--- :windows: Setting up Package Manager"
$env:ChocolateyInstall = Convert-Path "$((Get-Command choco).Path)\..\.."   
Import-Module "$env:ChocolateyInstall\helpers\chocolateyProfile.psm1"

Write-Output "--- :node: Installing NVM"
choco install nvm.portable -y
If ($LastExitCode -ne 0) { Exit $LastExitCode }

Write-Output "Refreshing the current PowerShell session's environment"
refreshenv

Write-Output "--- :node: Installing Node"
nvm install 20.8.1
nvm use 20.8.1
If ($LastExitCode -ne 0) { Exit $LastExitCode }

Write-Output "Refreshing the current PowerShell session's environment"
refreshenv

Write-Output "--- :npm: Installing Dependencies"
npm ci
If ($LastExitCode -ne 0) { Exit $LastExitCode }

Write-Output "--- :node: Building App"

# Fix issues with paths being too long
New-Item -Path C:\build -ItemType SymbolicLink -Value .\

cd C:\build
npm run make
If ($LastExitCode -ne 0) { Exit $LastExitCode }

aws secretsmanager get-secret-value --secret-id windows-code-signing-certificate > raw-cert.json
jq -r '.SecretString' raw-cert.json > signing-cert.pfx

ls
