import subprocess
import sys
from dataclasses import dataclass

from vt_agent.capture.app_identity import AppIdentity, resolve_app_display_name
from vt_agent.capture.browser_detect import BrowserContext, browser_hint, is_browser
from vt_agent.constants import URL_SCRIPT_TIMEOUT_SEC
from vt_agent.log import log


@dataclass(frozen=True, slots=True)
class ForegroundWindow:
    app_name: str
    title: str
    exe_name: str
    hwnd: int = 0
    process_name: str = ""
    app_user_model_id: str = ""
    is_browser: bool = False
    browser_hint: str = ""


def get_foreground_window() -> ForegroundWindow:
    if sys.platform == "win32":
        return _get_foreground_window_win()
    if sys.platform == "darwin":
        return _get_foreground_window_darwin()
    return ForegroundWindow("Unknown", "Unknown", "unknown")


def _build_window(
    *,
    title: str,
    process_name: str,
    exe_path: str = "",
    hwnd: int = 0,
    app_user_model_id: str = "",
    product_name: str = "",
    file_description: str = "",
    company_name: str = "",
    bundle_display_name: str = "",
    bundle_id: str = "",
    process_display_name: str = "",
) -> ForegroundWindow:
    identity = AppIdentity(
        window_title=title,
        process_name=process_name,
        exe_path=exe_path,
        app_user_model_id=app_user_model_id,
        product_name=product_name,
        file_description=file_description,
        company_name=company_name,
        bundle_display_name=bundle_display_name,
        bundle_id=bundle_id,
    )
    app_name = resolve_app_display_name(identity)

    browser_ctx = BrowserContext(
        process_name=process_name,
        exe_path=exe_path,
        app_user_model_id=app_user_model_id,
        product_name=product_name,
        file_description=file_description,
        company_name=company_name,
        display_name=app_name,
        bundle_id=bundle_id,
        process_display_name=process_display_name or process_name,
    )

    return ForegroundWindow(
        app_name=app_name,
        title=title or "Unknown",
        exe_name=process_name or "unknown",
        hwnd=hwnd,
        process_name=process_display_name or process_name,
        app_user_model_id=app_user_model_id,
        is_browser=is_browser(browser_ctx),
        browser_hint=browser_hint(browser_ctx),
    )


def _get_foreground_window_win() -> ForegroundWindow:
    try:
        import ctypes

        import psutil

        from vt_agent.capture.win.app_model import get_app_user_model_id
        from vt_agent.capture.win.metadata import get_exe_metadata

        user32 = ctypes.windll.user32
        hwnd = int(user32.GetForegroundWindow() or 0)
        length = user32.GetWindowTextLengthW(hwnd) + 1
        buf = ctypes.create_unicode_buffer(length)
        user32.GetWindowTextW(hwnd, buf, length)
        title = buf.value.strip() or "Unknown"

        pid = ctypes.c_ulong()
        user32.GetWindowThreadProcessId(hwnd, ctypes.byref(pid))

        process_name = "Unknown"
        exe_path = ""
        try:
            proc = psutil.Process(pid.value)
            process_name = proc.name() or "Unknown"
            exe_path = proc.exe() or ""
        except Exception:
            pass

        metadata = get_exe_metadata(exe_path) if exe_path else None
        aumid = get_app_user_model_id(hwnd) if hwnd else ""

        return _build_window(
            title=title,
            process_name=process_name,
            exe_path=exe_path,
            hwnd=hwnd,
            app_user_model_id=aumid,
            product_name=metadata.product_name if metadata else "",
            file_description=metadata.file_description if metadata else "",
            company_name=metadata.company_name if metadata else "",
        )
    except Exception as error:
        log.debug("Foreground window read failed: %s", error)
        return ForegroundWindow("Unknown", "Unknown", "unknown")


_DARWIN_FG_SCRIPT = """
tell application "System Events"
    set frontProc to missing value
    try
        set frontProc to first application process whose frontmost is true
    end try
    if frontProc is missing value then return "Unknown\\t\\tUnknown"
    set procName to name of frontProc
    set winTitle to ""
    try
        if (count of windows of frontProc) > 0 then
            set winTitle to name of front window of frontProc
        end if
    end try
    set bundleId to ""
    try
        set bundleId to bundle identifier of frontProc
    end try
    return procName & tab & bundleId & tab & winTitle
end tell
"""


def _get_foreground_window_darwin() -> ForegroundWindow:
    try:
        import psutil

        from vt_agent.capture.darwin.bundle import get_bundle_metadata

        result = subprocess.run(
            ["osascript", "-e", _DARWIN_FG_SCRIPT],
            capture_output=True,
            text=True,
            timeout=URL_SCRIPT_TIMEOUT_SEC,
            check=False,
        )
        line = (result.stdout or "").strip().splitlines()
        line = line[0] if line else ""
        parts = line.split("\t", 2)
        while len(parts) < 3:
            parts.append("")
        process_name, bundle_id, title = parts[0].strip(), parts[1].strip(), parts[2].strip()
        if not process_name or process_name.lower() == "unknown":
            return ForegroundWindow("Unknown", "Unknown", "unknown")

        exe_path = ""
        bundle_meta = None
        try:
            for proc in psutil.process_iter(["name", "exe"]):
                if (proc.info.get("name") or "").strip() == process_name:
                    exe_path = proc.info.get("exe") or ""
                    break
        except Exception:
            pass

        if exe_path:
            bundle_meta = get_bundle_metadata(exe_path)

        return _build_window(
            title=title or "Unknown",
            process_name=bundle_id or process_name,
            exe_path=exe_path,
            bundle_display_name=bundle_meta.display_name if bundle_meta else "",
            bundle_id=bundle_id or (bundle_meta.bundle_id if bundle_meta else ""),
            process_display_name=process_name,
        )
    except (subprocess.SubprocessError, OSError) as error:
        log.debug("Foreground window read failed: %s", error)
        return ForegroundWindow("Unknown", "Unknown", "unknown")
