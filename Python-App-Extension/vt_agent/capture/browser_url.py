import subprocess
import sys
from pathlib import Path

from vt_agent.capture.app_names import browser_hint_from_identifier
from vt_agent.constants import MAX_URL_LEN, URL_SCRIPT_TIMEOUT_SEC
from vt_agent.log import log


class BrowserUrlReader:
    def __init__(self, script_path: Path, macos_script_path: Path | None = None) -> None:
        self._script_path = script_path
        self._macos_script_path = macos_script_path or script_path

    def read_active_url(
        self,
        hwnd: int = 0,
        *,
        exe_name: str = "",
        process_name: str = "",
        browser_hint: str = "",
    ) -> str:
        if sys.platform == "win32":
            return self._read_windows(hwnd, exe_name, process_name, browser_hint)
        if sys.platform == "darwin":
            return self._read_macos(exe_name, process_name, browser_hint)
        return ""

    def _read_windows(
        self,
        hwnd: int,
        exe_name: str,
        process_name: str,
        browser_hint: str,
    ) -> str:
        if not self._script_path.exists():
            return ""
        try:
            cmd = [
                "powershell",
                "-STA",
                "-NoProfile",
                "-ExecutionPolicy",
                "Bypass",
                "-File",
                str(self._script_path),
            ]
            if hwnd:
                cmd.extend(["-WindowHandle", str(int(hwnd))])
            hint = (browser_hint or "").strip() or browser_hint_from_identifier(exe_name, process_name)
            if hint:
                cmd.extend(["-BrowserHint", hint])

            result = subprocess.run(
                cmd,
                capture_output=True,
                text=True,
                timeout=URL_SCRIPT_TIMEOUT_SEC,
                check=False,
            )
            url = (result.stdout or "").strip().splitlines()
            url = url[0].strip() if url else ""
            if url.startswith("http://") or url.startswith("https://"):
                return url[:MAX_URL_LEN]

            if result.returncode != 0 and result.stderr:
                log.debug("URL script stderr: %s", result.stderr.strip())
        except (subprocess.SubprocessError, OSError) as error:
            log.debug("URL read failed: %s", error)
        return ""

    def _read_macos(self, exe_name: str, process_name: str, browser_hint: str) -> str:
        if not self._macos_script_path.exists():
            return ""
        try:
            bundle_arg = exe_name or ""
            if "." in bundle_arg:
                bundle_arg = bundle_arg.lower()
            cmd = ["osascript", str(self._macos_script_path), bundle_arg, process_name or browser_hint or ""]
            result = subprocess.run(
                cmd,
                capture_output=True,
                text=True,
                timeout=URL_SCRIPT_TIMEOUT_SEC,
                check=False,
            )
            url = (result.stdout or "").strip().splitlines()
            url = url[0].strip() if url else ""
            if url.startswith("http://") or url.startswith("https://"):
                return url[:MAX_URL_LEN]

            if result.returncode != 0 and result.stderr:
                log.debug("macOS URL script stderr: %s", result.stderr.strip())
        except (subprocess.SubprocessError, OSError) as error:
            log.debug("macOS URL read failed: %s", error)
        return ""
