import threading
import time
import urllib.parse
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
        self._poll_generation = 0
        self._lock = threading.Lock()
        self._on_tokens: Callable[[str, str], None] | None = None
        self._on_error: Callable[[str], None] | None = None

    @property
    def pending_link_token(self) -> str | None:
        return self._pending.get("linkToken") if self._pending else None

    def _stop_poll_thread(self) -> None:
        if self._poll_thread and self._poll_thread.is_alive():
            self._stop.set()
            self._poll_thread.join(timeout=5)
        self._stop.clear()

    def _start_poll_thread(self, session: dict[str, str], generation: int) -> None:
        on_tokens = self._on_tokens
        on_error = self._on_error
        if on_tokens is None:
            return

        def poll() -> None:
            poll_session = session
            poll_gen = generation
            deadline = time.time() + 900
            while not self._stop.is_set() and time.time() < deadline:
                if self._poll_generation != poll_gen:
                    return
                result = self._api.exchange_link_session(
                    poll_session["linkToken"],
                    poll_session["agentSecret"],
                )
                if result:
                    if self._poll_generation == poll_gen:
                        self._pending = None
                    on_tokens(result["idToken"], result.get("refreshToken", ""))
                    return
                time.sleep(1)
            if self._poll_generation != poll_gen or self._stop.is_set():
                return
            self._pending = None
            log.warning("Agent link session timed out before credentials were exchanged")
            if on_error:
                on_error("Link timed out. Keep the agent open, click Sign In, then Link this account again.")

        self._poll_thread = threading.Thread(target=poll, name="vt-link-poll", daemon=True)
        self._poll_thread.start()

    def ensure_polling(
        self,
        on_tokens: Callable[[str, str], None],
        *,
        on_error: Callable[[str], None] | None = None,
    ) -> bool:
        """Keep exchanging credentials for the current pending session."""
        with self._lock:
            if not self._pending:
                return False
            self._on_tokens = on_tokens
            self._on_error = on_error
            if self._poll_thread and self._poll_thread.is_alive():
                return True
            self._poll_generation += 1
            generation = self._poll_generation
            self._start_poll_thread(dict(self._pending), generation)
            log.info("Resumed agent link credential exchange")
            return True

    def start(
        self,
        on_tokens: Callable[[str, str], None],
        *,
        on_error: Callable[[str], None] | None = None,
    ) -> bool:
        with self._lock:
            self._poll_generation += 1
            self._stop_poll_thread()
            self._on_tokens = on_tokens
            self._on_error = on_error

            session = self._api.create_link_session()
            if not session:
                log.warning("Could not start agent link session")
                if on_error:
                    on_error("Could not reach the server. Check your internet connection and try again.")
                return False

            generation = self._poll_generation
            self._pending = session
            link_token = session["linkToken"]
            encoded_token = urllib.parse.quote(link_token, safe="")
            sign_in_url = f"{self._web_url}/?link={encoded_token}"
            open_url_in_launcher_or_browser(sign_in_url, link_token=link_token)
            log.info("Opened sign-in page: %s", sign_in_url)
            self._start_poll_thread(session, generation)
            return True

    def stop(self) -> None:
        with self._lock:
            self._poll_generation += 1
            self._stop_poll_thread()
            self._pending = None
