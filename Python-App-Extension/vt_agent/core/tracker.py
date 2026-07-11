import threading
import time
from typing import Callable

from vt_agent.capture.activity import ActivityMeter
from vt_agent.capture.browser_url import BrowserUrlReader
from vt_agent.capture.events import EventBuilder
from vt_agent.capture.screen import ScreenCapture
from vt_agent.capture.window import ForegroundWindow, get_foreground_window
from vt_agent.client.api import ApiClient
from vt_agent.config import Settings
from vt_agent.constants import APP_LOG_INTERVAL_SEC, FIRST_SCREENSHOT_DELAY_SEC, SESSION_POLL_SEC
from vt_agent.log import log


class ActivityTracker:
    """Polls session and captures desktop activity while the web timer is active."""

    def __init__(
        self,
        api: ApiClient,
        settings: Settings,
        on_status: Callable[[str], None] | None = None,
        on_upload: Callable[[], None] | None = None,
    ) -> None:
        self._api = api
        self._settings = settings
        self._on_status = on_status
        self._on_upload = on_upload

        self._activity = ActivityMeter()
        self._events = EventBuilder(
            ScreenCapture(),
            self._activity,
            BrowserUrlReader(settings.url_script_path, settings.macos_url_script_path),
        )

        self.session_id: str | None = None
        self._stop = threading.Event()
        self._thread: threading.Thread | None = None
        self._last_app_log_at = 0.0
        self._next_screenshot_at = 0.0
        self._was_active = False

    def start(self) -> None:
        if self._thread and self._thread.is_alive():
            return
        self._activity.start()
        self._stop.clear()
        self._thread = threading.Thread(target=self._loop, name="vt-tracker", daemon=True)
        self._thread.start()

    def stop(self) -> None:
        self._stop.set()
        self.session_id = None

    def _emit_status(self, text: str) -> None:
        if self._on_status:
            self._on_status(text)

    def _notify_upload(self) -> None:
        if self._on_upload:
            self._on_upload()

    def _loop(self) -> None:
        while not self._stop.is_set():
            try:
                self._tick()
            except Exception as error:
                log.warning("Tracker tick failed: %s", error)
            self._stop.wait(SESSION_POLL_SEC)

    def _tick(self) -> None:
        session = self._api.fetch_session()
        if not session:
            if self._was_active:
                self._emit_status("Signed in — waiting for timer")
            self._was_active = False
            self.session_id = None
            return

        status = session.get("status")
        if status != "active":
            if status == "idle":
                self._emit_status("Timer idle — capture paused")
            elif self._was_active:
                self._emit_status("Signed in — waiting for timer")
            self._was_active = False
            self.session_id = None
            return

        session_id = session.get("id")
        if not isinstance(session_id, str) or not session_id:
            return

        window = get_foreground_window()

        if self.session_id != session_id:
            self.session_id = session_id
            self._last_app_log_at = 0.0
            self._next_screenshot_at = time.time() + FIRST_SCREENSHOT_DELAY_SEC
            log.info("Tracking session %s", session_id)
            self._upload_app_slice(window)
            self._last_app_log_at = time.time()

        self._was_active = True
        self._emit_status("Task session active")

        now = time.time()

        if now >= self._next_screenshot_at:
            self._upload_screenshot(window)
            self._next_screenshot_at = now + self._events.random_screenshot_delay_sec()

        if now - self._last_app_log_at >= APP_LOG_INTERVAL_SEC:
            self._upload_app_slice(window)
            self._last_app_log_at = now

    def _upload_screenshot(self, window: ForegroundWindow) -> None:
        if not self.session_id:
            return
        event = self._events.screenshot(window)
        if not event:
            return
        if self._api.post_events(self.session_id, [event]):
            self._notify_upload()

    def _upload_app_slice(self, window: ForegroundWindow) -> None:
        if not self.session_id:
            return

        app_event = self._events.app_slice(window)
        app_ok = self._api.post_events(self.session_id, [app_event])

        url_event = self._events.url_slice(window)
        url_ok = True
        if url_event:
            url_ok = self._api.post_events(self.session_id, [url_event])

        if app_ok:
            self._activity.reset()
            self._notify_upload()
            log.info(
                "Logged app slice: %s%s",
                app_event["appName"],
                " + URL" if url_event and url_ok else "",
            )
        elif url_event and url_ok:
            log.info("Logged URL slice (app upload failed): %s", url_event.get("url", "")[:80])
        else:
            log.warning("App/URL upload failed for session %s", self.session_id)
