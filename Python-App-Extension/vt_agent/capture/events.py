import random

from vt_agent.capture.activity import ActivityMeter
from vt_agent.capture.browser_url import BrowserUrlReader
from vt_agent.capture.screen import ScreenCapture
from vt_agent.capture.window import ForegroundWindow, get_foreground_window
from vt_agent.constants import (
    APP_LOG_INTERVAL_SEC,
    MAX_APP_NAME_LEN,
    MAX_PAGE_TITLE_LEN,
    MAX_URL_LEN,
    SCREENSHOT_MAX_DELAY_SEC,
    SCREENSHOT_MIN_DELAY_SEC,
)
from vt_agent.types import ActivityEvent, AppEvent, ScreenshotEvent, UrlEvent


class EventBuilder:
    def __init__(
        self,
        screen: ScreenCapture,
        activity: ActivityMeter,
        url_reader: BrowserUrlReader,
    ) -> None:
        self._screen = screen
        self._activity = activity
        self._url_reader = url_reader

    @staticmethod
    def random_screenshot_delay_sec() -> float:
        span = SCREENSHOT_MAX_DELAY_SEC - SCREENSHOT_MIN_DELAY_SEC
        return SCREENSHOT_MIN_DELAY_SEC + random.random() * span

    def screenshot(self, window: ForegroundWindow) -> ScreenshotEvent | None:
        image_data = self._screen.capture_jpeg_data_url()
        if not image_data:
            return None
        return ScreenshotEvent(
            type="screenshot",
            imageData=image_data,
            appName=window.app_name[:MAX_APP_NAME_LEN],
            pageTitle=window.title[:MAX_PAGE_TITLE_LEN],
            activityLevel=self._activity.score(),
        )

    def app_slice(self, window: ForegroundWindow) -> AppEvent:
        return AppEvent(
            type="app",
            appName=window.app_name[:MAX_APP_NAME_LEN],
            pageTitle=window.title[:MAX_PAGE_TITLE_LEN],
            durationSeconds=APP_LOG_INTERVAL_SEC,
        )

    def url_slice(self, window: ForegroundWindow) -> UrlEvent | None:
        if not window.is_browser:
            return None
        url = self._url_reader.read_active_url(
            window.hwnd,
            exe_name=window.exe_name,
            process_name=window.process_name,
            browser_hint=window.browser_hint,
        )
        if not url:
            return None
        return UrlEvent(
            type="url",
            url=url[:MAX_URL_LEN],
            pageTitle=window.title[:MAX_PAGE_TITLE_LEN],
            durationSeconds=APP_LOG_INTERVAL_SEC,
        )

    def app_and_url_events(self, window: ForegroundWindow | None = None) -> list[ActivityEvent]:
        fg = window or get_foreground_window()
        events: list[ActivityEvent] = [self.app_slice(fg)]
        url_event = self.url_slice(fg)
        if url_event:
            events.append(url_event)
        return events
