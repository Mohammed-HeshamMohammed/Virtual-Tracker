"""Shared helpers for application naming and validation."""

from __future__ import annotations

import re

# Small override map for cases where metadata is missing or overly verbose.
DISPLAY_NAME_OVERRIDES: dict[str, str] = {
    "code.exe": "VS Code",
    "cursor.exe": "Cursor",
    "devenv.exe": "Visual Studio",
    "explorer.exe": "File Explorer",
    "windowsterminal.exe": "Windows Terminal",
    "wt.exe": "Windows Terminal",
    "powershell.exe": "PowerShell",
    "cmd.exe": "Command Prompt",
    "winword.exe": "Microsoft Word",
    "excel.exe": "Microsoft Excel",
    "powerpnt.exe": "PowerPoint",
    "python.exe": "Python",
    "pythonw.exe": "Python",
    # macOS bundle ids
    "com.microsoft.vscode": "VS Code",
    "com.todesktop.230313mzl4w4u92": "Cursor",
}

_INVALID_APP_RE = re.compile(
    r"^(current-web-contents|chrome-extension|devtools|blob|data|about):",
    re.IGNORECASE,
)


def is_invalid_app_token(value: str) -> bool:
    text = (value or "").strip()
    if not text or text.lower() == "unknown":
        return True
    lower = text.lower()
    if "://" in text or "media-stream" in lower:
        return True
    if _INVALID_APP_RE.match(text):
        return True
    return False


def app_name_from_title_suffix(title: str) -> str:
    if " - " not in title:
        return ""
    suffix = title.rsplit(" - ", 1)[-1].strip()
    if is_invalid_app_token(suffix):
        return ""
    return suffix


def process_name_to_display(process_name: str) -> str:
    name = (process_name or "").strip()
    if not name or is_invalid_app_token(name):
        return ""
    if name.lower().endswith(".exe"):
        stem = name[:-4].replace(".", " ").replace("_", " ").strip()
        if stem:
            return stem.title()
    return name


# Backward-compatible helpers used by older imports.
def normalize_app_display_name(raw_name: str, title: str, exe_name: str) -> str:
    from vt_agent.capture.app_identity import AppIdentity, resolve_app_display_name

    return resolve_app_display_name(
        AppIdentity(
            window_title=title,
            process_name=exe_name,
            product_name=raw_name if not is_invalid_app_token(raw_name) else "",
        )
    )


def is_browser_exe(exe_name: str) -> bool:
    from vt_agent.capture.browser_detect import BrowserContext, is_browser

    return is_browser(BrowserContext(process_name=exe_name, bundle_id=exe_name))


def browser_hint_from_identifier(exe_name: str, process_name: str = "") -> str:
    from vt_agent.capture.browser_detect import BrowserContext, browser_hint

    return browser_hint(
        BrowserContext(
            process_name=exe_name,
            bundle_id=exe_name,
            process_display_name=process_name,
            display_name=process_name,
        )
    )
