# Build Virtual Tracker Tauri agent for Windows (production).
param(
  [string]$ApiUrl = "https://appapi.myvirtualtracker.com",
  [string]$WebUrl = "https://app.myvirtualtracker.com"
)

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot
Set-Location $Root

$env:VT_API_URL = $ApiUrl
$env:VT_WEB_URL = $WebUrl

@"
VT_API_URL=$ApiUrl
VT_WEB_URL=$WebUrl
VT_AUTH_PORT=17389
"@ | Set-Content -Path ".env.production" -Encoding UTF8

Write-Host "Installing npm dependencies..."
npm install

Write-Host "Building production Tauri app..."
npm run tauri:build

Write-Host ""
Write-Host "Build complete. Bundles are under:"
Write-Host "  src-tauri\target\release\bundle\"
Write-Host "API: $ApiUrl"
Write-Host "Web: $WebUrl"
