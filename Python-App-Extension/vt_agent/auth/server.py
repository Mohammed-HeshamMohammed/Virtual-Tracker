import json
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Callable

from vt_agent.constants import CREDENTIALS_LINK_PATH, HEALTH_PATH, RESUME_LINK_PATH
from vt_agent.log import log


class AuthServer:
    """Local health endpoint only — account linking uses secure backend sessions."""

    def __init__(
        self,
        port: int,
        *,
        get_pending_link: Callable[[], str | None] | None = None,
        is_authenticated: Callable[[], bool] | None = None,
        resume_link_poll: Callable[[], bool] | None = None,
        apply_web_credentials: Callable[[str, str, str], bool] | None = None,
    ) -> None:
        self._port = port
        self._get_pending_link = get_pending_link
        self._is_authenticated = is_authenticated
        self._resume_link_poll = resume_link_poll
        self._apply_web_credentials = apply_web_credentials
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
        is_authenticated = self._is_authenticated
        resume_link_poll = self._resume_link_poll
        apply_web_credentials = self._apply_web_credentials

        class Handler(BaseHTTPRequestHandler):
            def log_message(self, format: str, *args: object) -> None:
                return

            def _json(self, code: int, payload: dict[str, object]) -> None:
                body = json.dumps(payload).encode("utf-8")
                self.send_response(code)
                self.send_header("Access-Control-Allow-Origin", "*")
                self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
                self.send_header("Access-Control-Allow-Headers", "Content-Type")
                self.send_header("Content-Type", "application/json")
                self.end_headers()
                self.wfile.write(body)

            def _read_json_body(self) -> dict[str, object]:
                length = int(self.headers.get("Content-Length", 0))
                if length <= 0:
                    return {}
                raw = self.rfile.read(length)
                parsed = json.loads(raw.decode("utf-8"))
                return parsed if isinstance(parsed, dict) else {}

            def do_GET(self) -> None:
                if self.path != HEALTH_PATH:
                    self._json(404, {"success": False, "error": "Not found"})
                    return
                payload: dict[str, object] = {"ok": True, "agent": "python", "version": "0.2.0"}
                if is_authenticated:
                    payload["authenticated"] = is_authenticated()
                if get_pending_link:
                    link_token = get_pending_link()
                    payload["linkPending"] = bool(link_token)
                    if link_token:
                        payload["linkToken"] = link_token
                self._json(200, payload)

            def do_POST(self) -> None:
                if self.path == RESUME_LINK_PATH:
                    resumed = resume_link_poll() if resume_link_poll else False
                    link_token = get_pending_link() if get_pending_link else None
                    self._json(
                        200 if resumed else 409,
                        {
                            "ok": resumed,
                            "linkPending": bool(link_token),
                            "authenticated": is_authenticated() if is_authenticated else False,
                        },
                    )
                    return

                if self.path == CREDENTIALS_LINK_PATH:
                    body = self._read_json_body()
                    link_token = body.get("linkToken")
                    id_token = body.get("idToken")
                    refresh_token = body.get("refreshToken")
                    if (
                        not apply_web_credentials
                        or not isinstance(link_token, str)
                        or not isinstance(id_token, str)
                    ):
                        self._json(400, {"ok": False, "error": "Invalid credentials payload"})
                        return
                    refresh = refresh_token if isinstance(refresh_token, str) else ""
                    applied = apply_web_credentials(link_token, id_token, refresh)
                    self._json(
                        200 if applied else 409,
                        {
                            "ok": applied,
                            "authenticated": is_authenticated() if is_authenticated else False,
                        },
                    )
                    return

                self._json(404, {"success": False, "error": "Not found"})

            def do_OPTIONS(self) -> None:
                self._json(204, {})

        return Handler
