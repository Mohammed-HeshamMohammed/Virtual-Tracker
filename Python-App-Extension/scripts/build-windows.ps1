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
  [switch]$SkipInstaller
)

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot
Set-Location $Root

if (-not $ApiUrl) { $ApiUrl = "https://dashapi.myvirtualtracker.com" }
if (-not $WebUrl) { $WebUrl = "https://app.myvirtualtracker.com" }

Write-Host "Building Virtual Tracker Agent (Windows onedir)..."
Write-Host "  VT_API_URL=$ApiUrl"
Write-Host "  VT_WEB_URL=$WebUrl"

if (-not (Get-Command python -ErrorAction SilentlyContinue)) {
  throw "Python 3.10+ is required on the build machine."
}

python -m pip install --upgrade pip
python -m pip install -r requirements.txt pyinstaller

$env:VT_API_URL = $ApiUrl
$env:VT_WEB_URL = $WebUrl
$env:VT_AUTH_PORT = $AuthPort

python -m PyInstaller vt_agent.spec --noconfirm --clean

$OutDir = Join-Path $Root "dist\VirtualTrackerAgent"
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
    Write-Host "Inno Setup not found — skip installer or install from https://jrsoftware.org/isinfo.php"
    Write-Host "Then run: `"$Iscc`" installer\VirtualTrackerAgent.iss"
  }
}
