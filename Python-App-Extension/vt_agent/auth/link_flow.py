import threading
import time
from collections.abc import Callable

from vt_agent.client.api import ApiClient
from vt_agent.log import log
from vt_agent.utils import open_url_in_launcher_or_browser


class AgentLinkFlow:
    """Secure backend-mediated account linking (no browser → localhost token POST)."""

    def __init__(self, api: ApiClient, web_url: str) -> None:
        self._api = api
        self._web_url = web_url.rstrip("/")
        self._pending: dict[str, str] | None = None
        self._poll_thread: threading.Thread | None = None
        self._stop = threading.Event()

    @property
    def pending_link_token(self) -> str | None:
        return self._pending.get("linkToken") if self._pending else None

    def start(
        self,
        on_tokens: Callable[[str, str], None],
        *,
        on_error: Callable[[str], None] | None = None,
    ) -> bool:
        self._stop.clear()
        session = self._api.create_link_session()
        if not session:
            log.warning("Could not start agent link session")
            if on_error:
                on_error("Could not reach the server. Check your internet connection and try again.")
            return False

        self._pending = session
        link_token = session["linkToken"]
        sign_in_url = f"{self._web_url}/?link={link_token}"
        open_url_in_launcher_or_browser(sign_in_url, link_token=link_token)
        log.info("Opened sign-in page: %s", sign_in_url)

        if self._poll_thread and self._poll_thread.is_alive():
            self._stop.set()
            self._poll_thread.join(timeout=1)

        self._stop.clear()

        def poll() -> None:
            deadline = time.time() + 900
            while not self._stop.is_set() and time.time() < deadline:
                result = self._api.exchange_link_session(
                    session["linkToken"],
                    session["agentSecret"],
                )
                if result:
                    self._pending = None
                    on_tokens(result["idToken"], result.get("refreshToken", ""))
                    return
                time.sleep(1)
            self._pending = None
            log.warning("Agent link session timed out before credentials were exchanged")
            if on_error:
                on_error("Link timed out. Keep the agent open, click Sign In, then Link this account again.")

        self._poll_thread = threading.Thread(target=poll, name="vt-link-poll", daemon=True)
        self._poll_thread.start()
        return True

    def stop(self) -> None:
        self._stop.set()
        self._pending = None
