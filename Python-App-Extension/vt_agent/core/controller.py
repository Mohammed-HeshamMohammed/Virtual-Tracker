import urllib.parse
import webbrowser
from typing import Callable

from vt_agent.auth.link_flow import AgentLinkFlow
from vt_agent.auth.server import AuthServer
from vt_agent.auth.tokens import TokenStore
from vt_agent.client.api import ApiClient
from vt_agent.config import Settings
from vt_agent.constants import MIN_TOKEN_LENGTH
from vt_agent.core.tracker import ActivityTracker
from vt_agent.log import log


class AgentController:
    """Wires auth, API client, and activity tracker."""

    def __init__(self, settings: Settings) -> None:
        self.settings = settings
        self.store = TokenStore(settings.store_path)
        self.api = ApiClient(settings.api_url)
        self.tracker = ActivityTracker(
            self.api,
            settings,
            on_status=self._on_status_changed,
            on_upload=lambda: log.info("Activity uploaded"),
        )
        self._link_flow = AgentLinkFlow(self.api, settings.web_url)
        self.auth_server = AuthServer(
            settings.auth_port,
            get_pending_link=lambda: self._link_flow.pending_link_token,
            is_authenticated=lambda: self.api.is_authenticated,
        )
        self._status_listeners: list[Callable[[str], None]] = []
        self.status = "Not signed in"

    def add_status_listener(self, listener: Callable[[str], None]) -> None:
        self._status_listeners.append(listener)

    def start(self) -> None:
        self.auth_server.start()
        self._restore_session()
        log.info("API: %s", self.settings.api_url)
        log.info("Web: %s", self.settings.web_url)

    def stop(self) -> None:
        self._link_flow.stop()
        self.tracker.stop()
        self.auth_server.stop()
        self.api.close()

    def open_sign_in(self) -> bool:
        pending_token = self._link_flow.pending_link_token
        if pending_token:
            from vt_agent.utils import open_url_in_launcher_or_browser

            encoded_token = urllib.parse.quote(pending_token, safe="")
            sign_in_url = f"{self.settings.web_url}/?link={encoded_token}"
            open_url_in_launcher_or_browser(sign_in_url, link_token=pending_token)
            self._on_status_changed("Linking account...")
            return True

        self._link_flow.stop()
        self.tracker.stop()
        self.store.clear()
        self.api.set_tokens("", "")
        self._on_status_changed("Linking account...")
        return self._link_flow.start(
            self._apply_tokens,
            on_error=lambda msg: self._on_status_changed(msg),
        )

    def open_web_app(self) -> None:
        from vt_agent.utils import open_url_in_launcher_or_browser
        open_url_in_launcher_or_browser(self.settings.web_url)

    def _on_status_changed(self, text: str) -> None:
        self.status = text
        for listener in self._status_listeners:
            listener(text)

    def _restore_session(self) -> None:
        id_token, refresh = self.store.load()
        if id_token and len(id_token) >= MIN_TOKEN_LENGTH:
            self._apply_tokens(id_token, refresh)

    def _apply_tokens(self, id_token: str, refresh_token: str) -> None:
        self.store.save(id_token, refresh_token)
        self.api.set_tokens(id_token, refresh_token)
        self.api.on_tokens_refreshed = self.store.save
        self._on_status_changed("Signed in — waiting for timer")
        self.api.register_agent()
        self.tracker.start()
        log.info("Account linked")
