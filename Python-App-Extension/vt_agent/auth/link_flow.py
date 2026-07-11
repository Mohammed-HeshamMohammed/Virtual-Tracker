import os
import urllib.request
import urllib.parse
import threading
import time

from vt_agent.client.api import ApiClient
from vt_agent.log import log


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

    def start(self, on_tokens) -> None:
        self._stop.clear()
        session = self._api.create_link_session()
        if not session:
            log.warning("Could not start agent link session")
            return

        self._pending = session
        link_token = session["linkToken"]

        launcher_port = os.environ.get("VT_LAUNCHER_PORT")
        opened_in_launcher = False
        if launcher_port:
            try:
                encoded_token = urllib.parse.quote(link_token)
                url = f"http://localhost:{launcher_port}/open?link={encoded_token}"
                req = urllib.request.Request(url)
                with urllib.request.urlopen(req, timeout=3) as response:
                    if response.status == 200:
                        log.info("Successfully requested local launcher to open link in Dashboard")
                        opened_in_launcher = True
            except Exception as e:
                log.warning("Failed to open link via local launcher API: %s", e)

        if not opened_in_launcher:
            webbrowser.open(f"{self._web_url}/?link={link_token}")

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
                time.sleep(2)
            self._pending = None
            log.info("Agent link session timed out")

        self._poll_thread = threading.Thread(target=poll, name="vt-link-poll", daemon=True)
        self._poll_thread.start()

    def stop(self) -> None:
        self._stop.set()
        self._pending = None
