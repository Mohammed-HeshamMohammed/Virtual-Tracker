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

# Optional Authenticode signing (strongly recommended — unsigned builds trigger
# Avast / SmartScreen). Import a .pfx into Cert:\CurrentUser\My first, then:
#   $env:TAURI_SIGNING_WINDOWS_CERTIFICATE_THUMBPRINT = "<thumbprint>"
# Or set certificateThumbprint in src-tauri/tauri.conf.json.
# Docs: https://v2.tauri.app/distribute/sign/windows/

Write-Host "Building production Tauri app..."
npm run tauri:build

Write-Host ""
Write-Host "Build complete. Bundles are under:"
Write-Host "  src-tauri\target\release\bundle\"
Write-Host "API: $ApiUrl"
Write-Host "Web: $WebUrl"
if (-not $env:TAURI_SIGNING_WINDOWS_CERTIFICATE_THUMBPRINT) {
  Write-Host ""
  Write-Host "WARNING: Windows Authenticode thumbprint not set — installer will be NotSigned."
  Write-Host "Avast/SmartScreen will keep flagging unsigned agent builds."
}
