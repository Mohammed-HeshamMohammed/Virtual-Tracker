# Reads the focused browser address bar URL via UI Automation (Windows).
param(
    [long]$WindowHandle = 0,
    [string]$BrowserHint = ""
)

$ErrorActionPreference = "SilentlyContinue"

function Write-UrlIfValid([string]$Value) {
    if ([string]::IsNullOrWhiteSpace($Value)) { return $false }
    $trimmed = $Value.Trim()
    if ($trimmed -match '^https?://[^\s]+$') {
        Write-Output $trimmed
        exit 0
    }
    if ($trimmed -match '^[\w.-]+\.[a-zA-Z]{2,}(/[^\s]*)?$') {
        Write-Output "https://$trimmed"
        exit 0
    }
    return $false
}

function Try-ReadValuePattern($element) {
    try {
        $pattern = $element.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern)
        if ($null -eq $pattern) { return $false }
        return Write-UrlIfValid $pattern.Current.Value
    } catch {
        return $false
    }
}

function Try-LegacyValue($element) {
    try {
        $pattern = $element.GetCurrentPattern([System.Windows.Automation.LegacyIAccessiblePattern]::Pattern)
        if ($null -eq $pattern) { return $false }
        return Write-UrlIfValid $pattern.Current.Value
    } catch {
        return $false
    }
}

function Try-TextPattern($element) {
    try {
        $pattern = $element.GetCurrentPattern([System.Windows.Automation.TextPattern]::Pattern)
        if ($null -eq $pattern) { return $false }
        $text = $pattern.DocumentRange.GetText(4096)
        return Write-UrlIfValid $text
    } catch {
        return $false
    }
}

function Test-ElementUrl($element) {
    if (Try-ReadValuePattern $element) { return $true }
    if (Try-LegacyValue $element) { return $true }
    if (Try-TextPattern $element) { return $true }
    return $false
}

function Test-EditCandidate($element) {
    if ($null -eq $element) { return $false }
    try {
        if ($element.Current.ControlType.ProgrammaticName -ne "ControlType.Edit") {
            if ($element.Current.ControlType.ProgrammaticName -ne "ControlType.ComboBox") {
                return $false
            }
        }
    } catch {
        return $false
    }
    if (Test-InWebDocument $element) { return $false }
    return Test-ElementUrl $element
}

function Test-InWebDocument($element) {
    $parent = $element
    $depth = 0
    while ($null -ne $parent -and $depth -lt 24) {
        try {
            $typeName = $parent.Current.ControlType.ProgrammaticName
            if ($typeName -eq "ControlType.Document") { return $true }
            $parent = $parent.GetCurrentParent()
            $depth++
        } catch {
            break
        }
    }
    return $false
}

function Test-ReadByAutomationId($root, [string[]]$autoIds) {
    $scope = [System.Windows.Automation.TreeScope]::Descendants
    foreach ($autoId in $autoIds) {
        $idCond = New-Object System.Windows.Automation.PropertyCondition(
            [System.Windows.Automation.AutomationElement]::AutomationIdProperty,
            $autoId
        )
        $match = $root.FindFirst($scope, $idCond)
        if (Test-EditCandidate $match) { return $true }
    }
    return $false
}

function Test-ReadByAddressBarName($root) {
    $scope = [System.Windows.Automation.TreeScope]::Descendants
    $editType = [System.Windows.Automation.ControlType]::Edit
    $comboType = [System.Windows.Automation.ControlType]::ComboBox
    $addressBarNames = @(
        "Address and search bar",
        "Search or enter web address",
        "Search or type a URL",
        "Search with Google or enter address",
        "Enter search or web address",
        "Address bar",
        "Location"
    )
    foreach ($barName in $addressBarNames) {
        $nameCond = New-Object System.Windows.Automation.PropertyCondition(
            [System.Windows.Automation.AutomationElement]::NameProperty,
            $barName
        )
        foreach ($controlType in @($editType, $comboType)) {
            $typeCond = New-Object System.Windows.Automation.PropertyCondition(
                [System.Windows.Automation.AutomationElement]::ControlTypeProperty,
                $controlType
            )
            $andCond = New-Object System.Windows.Automation.AndCondition($typeCond, $nameCond)
            $match = $root.FindFirst($scope, $andCond)
            if (Test-EditCandidate $match) { return $true }
        }
    }
    return $false
}

function Test-ReadBrowserPanes($root, [string[]]$paneNames) {
    $scope = [System.Windows.Automation.TreeScope]::Descendants
    $editType = [System.Windows.Automation.ControlType]::Edit
    $comboType = [System.Windows.Automation.ControlType]::ComboBox
    $paneType = [System.Windows.Automation.ControlType]::Pane

    foreach ($paneName in $paneNames) {
        $nameCond = New-Object System.Windows.Automation.PropertyCondition(
            [System.Windows.Automation.AutomationElement]::NameProperty,
            $paneName
        )
        $paneCond = New-Object System.Windows.Automation.PropertyCondition(
            [System.Windows.Automation.AutomationElement]::ControlTypeProperty,
            $paneType
        )
        $andCond = New-Object System.Windows.Automation.AndCondition($paneCond, $nameCond)
        $pane = $root.FindFirst($scope, $andCond)
        if ($null -eq $pane) { continue }

        $editCond = New-Object System.Windows.Automation.PropertyCondition(
            [System.Windows.Automation.AutomationElement]::ControlTypeProperty,
            $editType
        )
        $edits = $pane.FindAll($scope, $editCond)
        foreach ($edit in $edits) {
            if (Test-EditCandidate $edit) { return $true }
        }

        $comboCond = New-Object System.Windows.Automation.PropertyCondition(
            [System.Windows.Automation.AutomationElement]::ControlTypeProperty,
            $comboType
        )
        $combos = $pane.FindAll($scope, $comboCond)
        foreach ($combo in $combos) {
            if (Test-InWebDocument $combo) { continue }
            if (Test-ElementUrl $combo) { return $true }
        }
    }
    return $false
}

Add-Type @"
using System;
using System.Runtime.InteropServices;
public class Win32 {
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
}
public class A11yWake {
  [DllImport("oleacc.dll")]
  public static extern int AccessibleObjectFromWindow(IntPtr hwnd, uint id, ref Guid riid, [MarshalAs(UnmanagedType.IUnknown)] out object obj);
  public static void Wake(IntPtr hwnd) {
    if (hwnd == IntPtr.Zero) { return; }
    Guid guid = new Guid("97885d64-a84a-4dfc-b774-422917317614");
    object acc;
    AccessibleObjectFromWindow(hwnd, 0x00000000, ref guid, out acc);
  }
}
"@

$hwnd = [IntPtr]$WindowHandle
if ($hwnd -eq [IntPtr]::Zero) {
    $hwnd = [Win32]::GetForegroundWindow()
}
if ($hwnd -eq [IntPtr]::Zero) { exit 0 }

[A11yWake]::Wake($hwnd)

Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes

# Heavy single-page apps (call-centre dialers especially) have huge
# accessibility trees. A broad FindAll on the browser root forces the whole
# renderer a11y tree to be realised, which on those pages spikes CPU and can
# crash the tab. The targeted strategies (1-3) below stop at the first match
# and are cheap on a normal page; if they've already burned this much wall
# time the page is heavy, so skip the broad fallback walk entirely and let
# the caller fall back to the window title (and, after a few misses in a row,
# stop probing this window - see URL_CAPTURE_MAX_FAILURES in the agent).
$sw = [System.Diagnostics.Stopwatch]::StartNew()
$BROAD_WALK_BUDGET_MS = 2500

$root = [System.Windows.Automation.AutomationElement]::FromHandle($hwnd)
if ($null -eq $root) { exit 0 }

$scope = [System.Windows.Automation.TreeScope]::Descendants
$editType = [System.Windows.Automation.ControlType]::Edit
$comboType = [System.Windows.Automation.ControlType]::ComboBox

$browserPaneNames = @(
    "Google Chrome",
    "Microsoft Edge",
    "Brave",
    "Opera",
    "Opera GX",
    "Opera Internet Browser",
    "Vivaldi",
    "Chromium",
    "Mozilla Firefox"
)
if (-not [string]::IsNullOrWhiteSpace($BrowserHint)) {
    $browserPaneNames = @($BrowserHint) + $browserPaneNames | Select-Object -Unique
}

# 1) Known automation ids (Chromium / Edge / Firefox / Opera variants)
$knownIds = @(
    "addressEditBox",
    "urlbar-input",
    "Omnibox",
    "OmniboxViewViews",
    "view_1012",
    "view_1011",
    "searchbox",
    "search_box",
    "addressbarEdit",
    "edit_2"
)
if (Test-ReadByAutomationId $root $knownIds) { exit 0 }

# 2) Named address bar controls (Chromium / Edge / Opera / Opera GX)
if (Test-ReadByAddressBarName $root) { exit 0 }

# 3) Browser toolbar panes — address bar lives here, not in the page document.
# Pane-scoped, but the pane can still contain the renderer, so honour the
# same heavy-page budget as the broad walks below.
if ($sw.ElapsedMilliseconds -le ($BROAD_WALK_BUDGET_MS * 2)) {
    if (Test-ReadBrowserPanes $root $browserPaneNames) { exit 0 }
}

# The targeted strategies missed. Anything past here is a broad descendant
# walk that realises the full renderer a11y tree - only worth it on a page
# light enough that we got here quickly. On a heavy page, bail now.
if ($sw.ElapsedMilliseconds -gt $BROAD_WALK_BUDGET_MS) { exit 0 }

# 4) Any edit/combo outside the web document (skip in-page search boxes when possible)
$editCond = New-Object System.Windows.Automation.PropertyCondition(
    [System.Windows.Automation.AutomationElement]::ControlTypeProperty,
    $editType
)
$edits = $root.FindAll($scope, $editCond)
foreach ($edit in $edits) {
    if ($sw.ElapsedMilliseconds -gt ($BROAD_WALK_BUDGET_MS * 2)) { exit 0 }
    if (Test-EditCandidate $edit) { exit 0 }
}

if ($sw.ElapsedMilliseconds -gt $BROAD_WALK_BUDGET_MS) { exit 0 }

$comboCond = New-Object System.Windows.Automation.PropertyCondition(
    [System.Windows.Automation.AutomationElement]::ControlTypeProperty,
    $comboType
)
$combos = $root.FindAll($scope, $comboCond)
foreach ($combo in $combos) {
    if ($sw.ElapsedMilliseconds -gt ($BROAD_WALK_BUDGET_MS * 2)) { exit 0 }
    if (Test-InWebDocument $combo) { continue }
    if (Test-ElementUrl $combo) { exit 0 }
}

exit 0
