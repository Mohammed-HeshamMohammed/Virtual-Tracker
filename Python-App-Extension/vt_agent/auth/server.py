import json
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Callable

from vt_agent.constants import HEALTH_PATH
from vt_agent.log import log


class AuthServer:
    """Local health endpoint only — account linking uses secure backend sessions."""

    def __init__(
        self,
        port: int,
        *,
        get_pending_link: Callable[[], str | None] | None = None,
    ) -> None:
        self._port = port
        self._get_pending_link = get_pending_link
        self._server: ThreadingHTTPServer | None = None
        self._thread: threading.Thread | None = None

    def start(self) -> None:
        if self._thread and self._thread.is_alive():
            return

        handler_cls = self._build_handler()

        def run() -> None:
            self._server = ThreadingHTTPServer(("127.0.0.1", self._port), handler_cls)
            log.info("Agent health listening on http://127.0.0.1:%s", self._port)
            self._server.serve_forever()

        self._thread = threading.Thread(target=run, name="vt-health-server", daemon=True)
        self._thread.start()

    def stop(self) -> None:
        if self._server:
            self._server.shutdown()
            self._server.server_close()
            self._server = None

    def _build_handler(self) -> type[BaseHTTPRequestHandler]:
        get_pending_link = self._get_pending_link

        class Handler(BaseHTTPRequestHandler):
            def log_message(self, format: str, *args: object) -> None:
                return

            def _json(self, code: int, payload: dict[str, object]) -> None:
                body = json.dumps(payload).encode("utf-8")
                self.send_response(code)
                self.send_header("Access-Control-Allow-Origin", "*")
                self.send_header("Access-Control-Allow-Methods", "GET, OPTIONS")
                self.send_header("Access-Control-Allow-Headers", "Content-Type")
                self.send_header("Content-Type", "application/json")
                self.end_headers()
                self.wfile.write(body)

            def do_GET(self) -> None:
                if self.path != HEALTH_PATH:
                    self._json(404, {"success": False, "error": "Not found"})
                    return
                payload: dict[str, object] = {"ok": True, "agent": "python", "version": "0.2.0"}
                if get_pending_link:
                    link_token = get_pending_link()
                    if link_token:
                        payload["linkToken"] = link_token
                self._json(200, payload)

            def do_OPTIONS(self) -> None:
                self._json(204, {})

        return Handler
