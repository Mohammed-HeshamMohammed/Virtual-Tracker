# Extracts the executable's icon as a base64 PNG (Windows).
# Prints "data:image/png;base64,<...>" on success, nothing otherwise.
param(
    [string]$ExePath = ""
)

$ErrorActionPreference = "SilentlyContinue"

if ([string]::IsNullOrWhiteSpace($ExePath) -or -not (Test-Path -LiteralPath $ExePath)) {
    exit 0
}

Add-Type -AssemblyName System.Drawing

try {
    $icon = [System.Drawing.Icon]::ExtractAssociatedIcon($ExePath)
    if ($null -eq $icon) { exit 0 }

    # ExtractAssociatedIcon returns the small (usually 32x32) icon. Render it
    # onto a 32x32 ARGB bitmap so the PNG has a stable size and alpha.
    $bmp = New-Object System.Drawing.Bitmap 32, 32
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $g.DrawIcon($icon, (New-Object System.Drawing.Rectangle 0, 0, 32, 32))
    $g.Dispose()

    $ms = New-Object System.IO.MemoryStream
    $bmp.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png)
    $bytes = $ms.ToArray()
    $ms.Dispose()
    $bmp.Dispose()
    $icon.Dispose()

    if ($bytes.Length -gt 0 -and $bytes.Length -lt 65536) {
        Write-Output ("data:image/png;base64," + [System.Convert]::ToBase64String($bytes))
    }
} catch {
    exit 0
}
