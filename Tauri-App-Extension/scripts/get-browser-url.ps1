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

# Every hop here is a cross-process COM round-trip into the browser, and this
# runs per candidate - so keep the ceiling tight. Page content sits under a
# Document within a few levels; the omnibox never does.
function Test-InWebDocument($element) {
    $parent = $element
    $depth = 0
    while ($null -ne $parent -and $depth -lt 10) {
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

function New-OrCondition([System.Windows.Automation.Condition[]]$conditions) {
    if ($conditions.Count -eq 1) { return $conditions[0] }
    return [System.Windows.Automation.OrCondition]::new($conditions)
}

# ONE tree walk, not one per id. A FindFirst that matches nothing has to
# enumerate the whole tree, and on a Chromium window that means forcing the
# renderer to realise its entire accessibility tree - so ten ids used to mean
# ten full realisations of a dialer's enormous DOM before we'd even given up.
function Test-ReadByAutomationId($root, [string[]]$autoIds) {
    $scope = [System.Windows.Automation.TreeScope]::Descendants
    $conds = foreach ($autoId in $autoIds) {
        New-Object System.Windows.Automation.PropertyCondition(
            [System.Windows.Automation.AutomationElement]::AutomationIdProperty,
            $autoId
        )
    }
    $match = $root.FindFirst($scope, (New-OrCondition $conds))
    return (Test-EditCandidate $match)
}

# Same collapse: one walk for (Edit OR ComboBox) AND (any known bar name).
function Test-ReadByAddressBarName($root) {
    $scope = [System.Windows.Automation.TreeScope]::Descendants
    $addressBarNames = @(
        # SOURCE OF TRUTH: browsers.rs omnibox_names() (all engines).
        "Address and search bar",
        "Address bar",
        "Search or enter web address",
        "Search or type a URL",
        "Search or enter an address",
        "Location",
        "Search with Google or enter address",
        "Search with DuckDuckGo or enter address",
        "Search with Bing or enter address",
        "Enter search or web address",
        "Search or enter address"
    )
    $nameConds = foreach ($barName in $addressBarNames) {
        New-Object System.Windows.Automation.PropertyCondition(
            [System.Windows.Automation.AutomationElement]::NameProperty,
            $barName
        )
    }
    $typeConds = foreach ($controlType in @(
        [System.Windows.Automation.ControlType]::Edit,
        [System.Windows.Automation.ControlType]::ComboBox
    )) {
        New-Object System.Windows.Automation.PropertyCondition(
            [System.Windows.Automation.AutomationElement]::ControlTypeProperty,
            $controlType
        )
    }
    $andCond = New-Object System.Windows.Automation.AndCondition(
        (New-OrCondition $typeConds),
        (New-OrCondition $nameConds)
    )
    $match = $root.FindFirst($scope, $andCond)
    return (Test-EditCandidate $match)
}

# One walk to find the browser's own pane (any of the known names), then the
# edit/combo search is scoped to that pane instead of the whole window.
function Test-ReadBrowserPanes($root, [string[]]$paneNames) {
    $scope = [System.Windows.Automation.TreeScope]::Descendants
    $editType = [System.Windows.Automation.ControlType]::Edit
    $comboType = [System.Windows.Automation.ControlType]::ComboBox
    $paneType = [System.Windows.Automation.ControlType]::Pane

    $nameConds = foreach ($paneName in $paneNames) {
        New-Object System.Windows.Automation.PropertyCondition(
            [System.Windows.Automation.AutomationElement]::NameProperty,
            $paneName
        )
    }
    $paneCond = New-Object System.Windows.Automation.PropertyCondition(
        [System.Windows.Automation.AutomationElement]::ControlTypeProperty,
        $paneType
    )
    $andCond = New-Object System.Windows.Automation.AndCondition(
        $paneCond,
        (New-OrCondition $nameConds)
    )
    $pane = $root.FindFirst($scope, $andCond)
    if ($null -eq $pane) { return $false }

    $typeCond = New-OrCondition @(
        (New-Object System.Windows.Automation.PropertyCondition(
            [System.Windows.Automation.AutomationElement]::ControlTypeProperty, $editType)),
        (New-Object System.Windows.Automation.PropertyCondition(
            [System.Windows.Automation.AutomationElement]::ControlTypeProperty, $comboType))
    )
    $candidates = $pane.FindAll($scope, $typeCond)
    foreach ($candidate in $candidates) {
        if (Test-EditCandidate $candidate) { return $true }
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
    # SOURCE OF TRUTH: src-tauri/src/capture/browsers.rs (BROWSERS[].pane_name).
    # A Rust test (script_pane_names_match_the_registry) fails if these drift.
    "Google Chrome",
    "Microsoft Edge",
    "Brave",
    "Vivaldi",
    "Chromium",
    "Opera",
    "Opera GX",
    "Arc",
    "Yandex",
    "Whale",
    "Mozilla Firefox",
    "Waterfox",
    "LibreWolf",
    "Zen Browser",
    "Internet Explorer",
    "Safari"
)
if (-not [string]::IsNullOrWhiteSpace($BrowserHint)) {
    $browserPaneNames = @($BrowserHint) + $browserPaneNames | Select-Object -Unique
}

# 1) Known automation ids (Chromium / Edge / Firefox / Opera variants)
$knownIds = @(
    # SOURCE OF TRUTH: browsers.rs omnibox_automation_ids() (all engines).
    "Omnibox",
    "OmniboxViewViews",
    "addressEditBox",
    "addressbarEdit",
    "view_1012",
    "view_1011",
    "searchbox",
    "search_box",
    "edit_2",
    "urlbar-input",
    "urlbar"
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
