<#
  Puts the WebView2 109 fixed-version runtime where the legacy build bundles it
  (src-tauri/webview2-fixed-runtime, see src-tauri/tauri.legacy.conf.json).

  The legacy build (Windows 7, 8 and 8.1) cannot rely on WebView2 being installed: those
  systems cannot run the current installer, and installing it is ruled out for the members
  who need this build. So it ships its own copy, 109 being the last version that runs there.
  See PLAN-windows-7-legacy-build.md, "WebView2 109 runtime".

  Where the runtime comes from is set outside the repo, because it is ~150 MB and must never
  be committed:
    WEBVIEW2_RUNTIME_URL     one of:
                             - Microsoft's "WebView2 Runtime Version 109 Update" package from the
                               Microsoft Update Catalog (an .exe; 109.0.1518.140 x86 is
                               microsoftedgestandaloneinstallerx86_179f59bc...exe). It holds the
                               same files as the runtime and is unpacked with 7-Zip, never run.
                             - a fixed-version .cab, .zip or .nupkg
    WEBVIEW2_RUNTIME_SHA256  the SHA-256 of that file; nothing is used unless it matches
  -Package <file> uses a file already on disk instead of downloading.

  Whatever the source, every .exe and .dll in it must carry a valid Microsoft signature.
  109.0.1518.140 is the build to ship: earlier 109 builds lack the fix for CVE-2023-4863,
  an exploited flaw in WebP image decoding. Any other version is refused unless
  WEBVIEW2_ALLOW_OLDER=1 is set on purpose.
#>
param(
  [string]$Package = "",
  [string]$Url = $env:WEBVIEW2_RUNTIME_URL,
  [string]$Sha256 = $env:WEBVIEW2_RUNTIME_SHA256,
  [string]$Destination = (Join-Path $PSScriptRoot "..\src-tauri\webview2-fixed-runtime")
)
$ErrorActionPreference = "Stop"
$Wanted = "109.0.1518.140"

if ((-not $Url -and -not $Package) -or -not $Sha256) {
  throw "WEBVIEW2_RUNTIME_URL and WEBVIEW2_RUNTIME_SHA256 must both be set. The legacy build cannot be made without the WebView2 109 runtime."
}

$work = Join-Path ([System.IO.Path]::GetTempPath()) ("webview2-" + [guid]::NewGuid())
New-Item -ItemType Directory -Path $work | Out-Null
try {
  if ($Package) {
    $name = [System.IO.Path]::GetFileName($Package)
    $download = Join-Path $work $name
    Copy-Item $Package $download
  } else {
    $name = [System.IO.Path]::GetFileName(([uri]$Url).AbsolutePath)
    if (-not $name) { $name = "runtime.bin" }
    $download = Join-Path $work $name
    Write-Host "Downloading $name"
    $ProgressPreference = "SilentlyContinue"
    Invoke-WebRequest -Uri $Url -OutFile $download -UseBasicParsing
  }

  $actual = (Get-FileHash -Algorithm SHA256 $download).Hash
  if ($actual -ne $Sha256.Trim().ToUpperInvariant()) {
    throw "SHA-256 mismatch for $name. Expected $Sha256, got $actual."
  }

  $unpacked = Join-Path $work "unpacked"
  New-Item -ItemType Directory -Path $unpacked | Out-Null
  if ($name -match '\.exe$') {
    # Microsoft Update Catalog package: Edge Update setup > MicrosoftEdge_X86_<version>.exe >
    # MSEDGE.7z > Chrome-bin\<version>\, the same files as the WebView2 runtime. Unpacked, not run.
    $sevenZip = (Get-Command 7z -ErrorAction SilentlyContinue).Source
    if (-not $sevenZip) { $sevenZip = Join-Path $env:ProgramFiles "7-Zip\7z.exe" }
    if (-not (Test-Path $sevenZip)) { throw "7-Zip is needed to unpack $name" }
    $outer = Join-Path $work "outer"
    & $sevenZip e -y "-o$outer" $download "MicrosoftEdge_*.exe*" | Out-Null
    $inner = Get-ChildItem $outer -Filter "MicrosoftEdge_*" | Select-Object -First 1
    if (-not $inner) { throw "$name does not contain a MicrosoftEdge_*.exe package" }
    & $sevenZip e -y "-o$outer" $inner.FullName "MSEDGE.7z" | Out-Null
    & $sevenZip x -y "-o$unpacked" (Join-Path $outer "MSEDGE.7z") | Out-Null
    if ($LASTEXITCODE -ne 0) { throw "7-Zip failed on $name" }
  } elseif ($name -match '\.cab$') {
    # Microsoft's own instructions: expand, not Explorer, keeps the folder structure.
    & expand.exe $download "-F:*" $unpacked | Out-Null
    if ($LASTEXITCODE -ne 0) { throw "expand.exe failed on $name" }
  } else {
    # .zip and .nupkg are both zip files.
    $zip = Join-Path $work "runtime.zip"
    Copy-Item $download $zip
    Expand-Archive -Path $zip -DestinationPath $unpacked
  }

  # The runtime is the folder that holds msedgewebview2.exe.
  $exe = Get-ChildItem -Path $unpacked -Recurse -Filter "msedgewebview2.exe" | Select-Object -First 1
  if (-not $exe) { throw "No msedgewebview2.exe in $name; this is not a WebView2 fixed-version runtime." }
  $runtime = $exe.Directory.FullName

  $version = (Get-Item $exe.FullName).VersionInfo.ProductVersion
  if ($version -ne $Wanted -and $env:WEBVIEW2_ALLOW_OLDER -ne "1") {
    throw "This is WebView2 $version. Ship $Wanted (the only 109 build with the CVE-2023-4863 fix), or set WEBVIEW2_ALLOW_OLDER=1 knowingly; see the plan's 'Security notes' for what that then requires."
  }

  # The Edge package also carries Google's Widevine plugin for protected video (signed by Google,
  # not Microsoft). The tracker never plays protected video, and Chromium only loads the plugin
  # when a page asks for it, so it is left out rather than allowing a second signer.
  $widevine = Join-Path $runtime "WidevineCdm"
  if (Test-Path $widevine) { Remove-Item -Recurse -Force $widevine }

  # Every program file must be Microsoft's, whatever site the package came from.
  $unsigned = Get-ChildItem -Path $runtime -Recurse -Include *.exe, *.dll | Where-Object {
    $signature = Get-AuthenticodeSignature $_.FullName
    $signature.Status -ne "Valid" -or $signature.SignerCertificate.Subject -notmatch "O=Microsoft Corporation"
  }
  if ($unsigned) {
    $unsigned | ForEach-Object { Write-Host "::error::Not validly signed by Microsoft: $($_.FullName)" }
    throw "The runtime contains files without a valid Microsoft signature."
  }

  if (Test-Path $Destination) { Remove-Item -Recurse -Force $Destination }
  Copy-Item -Recurse $runtime $Destination
  $size = (Get-ChildItem -Recurse $Destination | Measure-Object -Sum Length).Sum
  Write-Host ("WebView2 {0} ready in {1} ({2:N0} MB, all files signed by Microsoft)." -f $version, $Destination, ($size / 1MB))
}
finally {
  Remove-Item -Recurse -Force $work -ErrorAction SilentlyContinue
}
