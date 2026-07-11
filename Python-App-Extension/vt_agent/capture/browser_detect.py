"""Browser classification separate from display-name resolution."""

from __future__ import annotations

import re
import sys
from dataclasses import dataclass

from vt_agent.capture.app_names import is_invalid_app_token

# Fast-path fallback when metadata is missing (lowercase exe / bundle / process keys).
_BROWSER_EXE_FALLBACK_WIN: frozenset[str] = frozenset(
    {
        "chrome.exe",
        "msedge.exe",
        "firefox.exe",
        "brave.exe",
        "opera.exe",
        "operagx.exe",
        "launcher.exe",
        "vivaldi.exe",
        "waterfox.exe",
        "browser.exe",
        "zen.exe",
        "chromium.exe",
        "dragon.exe",
        "iexplore.exe",
    }
)

_BROWSER_BUNDLE_IDS_DARWIN: frozenset[str] = frozenset(
    {
        "com.google.chrome",
        "com.microsoft.edgemac",
        "com.apple.safari",
        "org.mozilla.firefox",
        "com.brave.browser",
        "com.operasoftware.opera",
        "com.operasoftware.operagx",
        "com.vivaldi.vivaldi",
        "company.thebrowser.browser",
        "com.google.chrome.canary",
    }
)

_BROWSER_PROCESS_NAMES_DARWIN: frozenset[str] = frozenset(
    {
        "safari",
        "google chrome",
        "microsoft edge",
        "firefox",
        "brave browser",
        "opera",
        "opera gx",
        "vivaldi",
        "arc",
        "chromium",
    }
)

_BROWSER_AUMID_PREFIXES: tuple[str, ...] = (
    "MSEdge",
    "Microsoft.MicrosoftEdge",
    "Chrome",
    "Firefox",
    "Opera",
    "OperaStable",
    "Brave",
    "Vivaldi",
)

_BROWSER_METADATA_RE = re.compile(
    r"\b("
    r"chrome|chromium|edge|firefox|safari|"
    r"opera|brave|vivaldi|waterfox|zen browser|arc"
    r")\b",
    re.IGNORECASE,
)

_BROWSER_COMPANY_RE = re.compile(
    r"\b("
    r"google|mozilla|microsoft|opera|brave software|vivaldi technologies"
    r")\b",
    re.IGNORECASE,
)


@dataclass(frozen=True, slots=True)
class BrowserContext:
    process_name: str = ""
    exe_path: str = ""
    app_user_model_id: str = ""
    product_name: str = ""
    file_description: str = ""
    company_name: str = ""
    display_name: str = ""
    bundle_id: str = ""
    process_display_name: str = ""


def is_browser(context: BrowserContext) -> bool:
    if sys.platform == "darwin":
        return _is_browser_darwin(context)
    return _is_browser_windows(context)


def browser_hint(context: BrowserContext) -> str:
    display = (context.display_name or "").strip()
    if display and not is_invalid_app_token(display):
        return display

    if sys.platform == "darwin":
        return context.process_display_name or context.bundle_id or context.process_name

    return context.product_name or context.process_name


def _is_browser_windows(context: BrowserContext) -> bool:
    exe_key = _exe_key(context)
    if exe_key in _BROWSER_EXE_FALLBACK_WIN:
        return True

    aumid = (context.app_user_model_id or "").strip()
    if aumid and any(aumid.startswith(prefix) for prefix in _BROWSER_AUMID_PREFIXES):
        return True

    if _looks_like_browser_metadata(
        context.product_name,
        context.file_description,
        context.company_name,
        context.display_name,
    ):
        return True

    return False


def _is_browser_darwin(context: BrowserContext) -> bool:
    bundle_key = (context.bundle_id or "").strip().lower()
    if bundle_key in _BROWSER_BUNDLE_IDS_DARWIN:
        return True

    process_key = (context.process_display_name or context.process_name or "").strip().lower()
    if process_key in _BROWSER_PROCESS_NAMES_DARWIN:
        return True

    if _looks_like_browser_metadata(
        context.product_name or context.bundle_id,
        context.file_description,
        "",
        context.display_name or context.process_display_name,
    ):
        return True

    return False


def _exe_key(context: BrowserContext) -> str:
    path = (context.exe_path or "").strip()
    if path:
        name = path.rsplit("\\", 1)[-1].rsplit("/", 1)[-1]
        if name:
            return name.lower()
    return (context.process_name or "").strip().lower()


def _looks_like_browser_metadata(*fields: str) -> bool:
    joined = " ".join(field for field in fields if field).strip()
    if not joined:
        return False
    if _BROWSER_METADATA_RE.search(joined):
        return True
    if _BROWSER_COMPANY_RE.search(joined) and re.search(
        r"\b(browser|internet)\b", joined, re.IGNORECASE
    ):
        return True
    return False
