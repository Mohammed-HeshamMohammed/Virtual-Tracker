import base64
import json
import sys
import threading
import urllib.error
import urllib.request
import webbrowser
from importlib.metadata import version
from pathlib import Path

import requests
import webview

from vt_agent.core.controller import AgentController
from vt_agent.ui.tray import TrayController

USE_FRAMELESS = False
WINDOW_BG = "#060e20"

try:
    AGENT_VERSION = version("virtual-tracker-agent")
except Exception:
    AGENT_VERSION = "0.2.0"


def _jwt_payload(id_token: str) -> dict:
    try:
        parts = id_token.split(".")
        if len(parts) < 2:
            return {}
        padded = parts[1] + "=" * (-len(parts[1]) % 4)
        return json.loads(base64.urlsafe_b64decode(padded))
    except (ValueError, json.JSONDecodeError, TypeError):
        return {}


def _server_label(api_url: str) -> str:
    host = api_url.replace("http://", "").replace("https://", "")
    return f"Ext-Server: {host}"


class WebviewApi:
    def __init__(self, controller: AgentController, app_ui: "AgentUiApp") -> None:
        self._controller = controller
        self._app_ui = app_ui

    def sign_in(self) -> dict[str, object]:
        ok = self._controller.open_sign_in()
        if ok:
            return {"success": True}
        return {
            "success": False,
            "error": "Could not reach the server. Check your internet connection and try again.",
        }

    def open_web_app(self) -> None:
        self._controller.open_web_app()

    def hide_to_tray(self) -> None:
        self._app_ui.hide_to_tray()

    def minimize_window(self) -> None:
        self._app_ui.minimize_window()

    def close_window(self) -> None:
        self._app_ui.hide_to_tray()

    def get_status(self) -> str:
        return self._controller.status

    def get_version(self) -> str:
        return AGENT_VERSION

    def get_profile(self) -> dict:
        token = self._controller.api.id_token
        server_label = _server_label(self._controller.settings.api_url)
        status = self._controller.status.lower()
        link_pending = "linking" in status
        if not token:
            return {
                "signedIn": False,
                "linkPending": link_pending,
                "name": "Finish linking in browser" if link_pending else "Not signed in",
                "avatarUrl": "",
                "serverLabel": server_label,
            }
        claims = _jwt_payload(token)
        name = claims.get("name") or claims.get("email") or "Signed in"
        picture = claims.get("picture")
        return {
            "signedIn": True,
            "name": str(name),
            "avatarUrl": picture if isinstance(picture, str) else "",
            "serverLabel": server_label,
        }

    def get_link_status(self) -> dict:
        api_url = self._controller.settings.api_url
        connected = False
        try:
            res = requests.get(f"{api_url}/health", timeout=2)
            connected = res.ok
        except requests.RequestException:
            connected = False
        return {
            "connected": connected,
            "serverLabel": _server_label(api_url),
            "status": self._controller.status,
        }

    def open_launcher_setup(self) -> None:
        url = self._controller.settings.launcher_url.rstrip("/")
        focus_url = f"{url}/api/launcher/focus"
        try:
            req = urllib.request.Request(
                focus_url,
                data=b"{}",
                method="POST",
                headers={"Content-Type": "application/json"},
            )
            urllib.request.urlopen(req, timeout=2)
        except (urllib.error.URLError, TimeoutError, OSError):
            webbrowser.open(f"{url}/")


class AgentUiApp:
    def __init__(self, agent: AgentController) -> None:
        self._agent = agent
        self._api = WebviewApi(agent, self)
        self._tray = TrayController(agent, on_show=self.show_from_tray, on_quit=self.shutdown)
        self.window = None

        self._agent.add_status_listener(self._update_status)

    def start(self) -> None:
        gui_path = Path(__file__).resolve().parent / "gui" / "index.html"

        self.window = webview.create_window(
            title="Virtual Callers",
            url=str(gui_path),
            js_api=self._api,
            width=320,
            height=650,
            min_size=(320, 600),
            resizable=False,
            frameless=USE_FRAMELESS,
            easy_drag=False,
            background_color=WINDOW_BG,
        )

        self.window.events.closing += self.on_window_closing

        self._agent.start()
        webview.start(debug=False)

    def on_window_closing(self) -> bool:
        self.hide_to_tray()
        return False

    def hide_to_tray(self) -> None:
        if self.window:
            self.window.hide()
            self._tray.show()

    def minimize_window(self) -> None:
        if self.window:
            self.window.minimize()

    def show_from_tray(self) -> None:
        if self.window:
            self._tray.hide()
            self.window.show()
            self.window.restore()

    def shutdown(self) -> None:
        self._tray.hide()
        self._agent.stop()
        if self.window:
            self.window.events.closing -= self.on_window_closing
            self.window.destroy()
        sys.exit(0)

    def _update_status(self, text: str) -> None:
        if self.window:
            safe_text = text.replace("'", "\\'").replace("\n", " ")
            try:
                self.window.evaluate_js(
                    f"if (window.updateStatus) {{ window.updateStatus('{safe_text}'); }}"
                )
            except Exception:
                pass


def run_ui(agent: AgentController, *, prompt_sign_in: bool = True) -> None:
    app = AgentUiApp(agent)

    if prompt_sign_in and not agent.api.is_authenticated:
        def auto_sign_in() -> None:
            import time

            time.sleep(2)
            if not agent.api.is_authenticated and not agent.is_link_pending:
                agent.open_sign_in()

        threading.Thread(target=auto_sign_in, daemon=True).start()

    app.start()
