#Requires -Version 5.1
<#
.SYNOPSIS
  Build Virtual Tracker agent for Windows (PyInstaller onedir + optional Inno Setup installer).

.EXAMPLE
  .\scripts\build-windows.ps1 `
    -ApiUrl "https://dashapi.myvirtualtracker.com" `
    -WebUrl "https://app.myvirtualtracker.com"
#>
param(
  [string]$ApiUrl = $env:VT_API_URL,
  [string]$WebUrl = $env:VT_WEB_URL,
  [string]$AuthPort = "17389",
  [switch]$SkipInstaller,
  [switch]$StopRunningAgent
)

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot
Set-Location $Root

$DefaultsFile = Join-Path $Root "production.defaults.env"
if (Test-Path $DefaultsFile) {
  Get-Content $DefaultsFile | ForEach-Object {
    $line = $_.Trim()
    if (-not $line -or $line.StartsWith("#") -or $line -notmatch "=") { return }
    $key, $val = $line -split "=", 2
    if ($key -eq "VT_API_URL" -and -not $ApiUrl) { $ApiUrl = $val.Trim() }
    if ($key -eq "VT_WEB_URL" -and -not $WebUrl) { $WebUrl = $val.Trim() }
    if ($key -eq "VT_AUTH_PORT" -and -not $AuthPort) { $AuthPort = $val.Trim() }
  }
}

if (-not $ApiUrl) { $ApiUrl = "https://appapi.myvirtualtracker.com" }
if (-not $WebUrl) { $WebUrl = "https://app.myvirtualtracker.com" }
if (-not $AuthPort) { $AuthPort = "17389" }

Write-Host "Building Virtual Tracker Agent (Windows onedir)..."
Write-Host "  VT_API_URL=$ApiUrl"
Write-Host "  VT_WEB_URL=$WebUrl"

if (-not (Get-Command python -ErrorAction SilentlyContinue)) {
  throw "Python 3.10+ is required on the build machine."
}

$OutDir = Join-Path $Root "dist\VirtualTrackerAgent"
$RunningAgent = Get-Process -Name "VirtualTrackerAgent" -ErrorAction SilentlyContinue

if ($RunningAgent) {
  if ($StopRunningAgent) {
    Write-Host "Stopping running VirtualTrackerAgent process(es)..."
    $RunningAgent | Stop-Process -Force
    Start-Sleep -Seconds 2
  } else {
    throw @"
VirtualTrackerAgent is still running and locks dist\VirtualTrackerAgent.

Close the agent (including the system tray icon), then rebuild.
Or rerun with -StopRunningAgent to force-close it:

  .\scripts\build-windows.ps1 -SkipInstaller -StopRunningAgent
"@
  }
}

python -m pip install --upgrade pip
if ($LASTEXITCODE -ne 0) { throw "pip upgrade failed with exit code $LASTEXITCODE" }

python -m pip install -r requirements.txt pyinstaller
if ($LASTEXITCODE -ne 0) { throw "Dependency install failed with exit code $LASTEXITCODE" }

$env:VT_API_URL = $ApiUrl
$env:VT_WEB_URL = $WebUrl
$env:VT_AUTH_PORT = $AuthPort

python -m PyInstaller vt_agent.spec --noconfirm --clean
if ($LASTEXITCODE -ne 0) {
  throw "PyInstaller failed with exit code $LASTEXITCODE. If the agent was running, close it and rebuild."
}

if (-not (Test-Path $OutDir)) {
  throw "Expected output folder not found: $OutDir"
}

Write-Host ""
Write-Host "Build complete: $OutDir"
Write-Host "Run: $OutDir\VirtualTrackerAgent.exe"

if (-not $SkipInstaller) {
  $Iscc = "${env:ProgramFiles(x86)}\Inno Setup 6\ISCC.exe"
  if (Test-Path $Iscc) {
    & $Iscc "installer\VirtualTrackerAgent.iss"
    Write-Host "Installer: dist\VirtualTrackerAgent-Setup.exe"
  } else {
    Write-Host "Inno Setup not found - skip installer or install from https://jrsoftware.org/isinfo.php"
    Write-Host ('Then run: "' + $Iscc + '" installer\VirtualTrackerAgent.iss')
  }
}
