#Requires -Version 5.1
<#
.SYNOPSIS
  Zip the PyInstaller onedir output for teams without Inno Setup.
#>
$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot
$Source = Join-Path $Root "dist\VirtualTrackerAgent"
$Zip = Join-Path $Root "dist\VirtualTrackerAgent-Portable.zip"

if (-not (Test-Path $Source)) {
  throw "Run scripts\build-windows.ps1 -SkipInstaller first. Missing: $Source"
}

if (Test-Path $Zip) { Remove-Item $Zip -Force }
Compress-Archive -Path (Join-Path $Source "*") -DestinationPath $Zip -CompressionLevel Optimal
Write-Host "Created: $Zip"
Write-Host "Team: unzip, run VirtualTrackerAgent.exe, pin shortcut if desired."
