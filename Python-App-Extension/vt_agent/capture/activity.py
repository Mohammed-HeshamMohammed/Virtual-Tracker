import threading
import time

from vt_agent.constants import (
    ACTIVITY_MIN_SCORE,
    ACTIVITY_SATURATION_EVENTS,
    ACTIVITY_WINDOW_MS,
)


class ActivityMeter:
    """Rolling mouse/keyboard activity score (0–100), aligned with web activity-level.ts."""

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._input_count = 0
        self._window_start_ms = time.time() * 1000
        self._listener_started = False

    def _on_input(self) -> None:
        with self._lock:
            self._input_count += 1

    def start(self) -> None:
        if self._listener_started:
            return
        self._listener_started = True
        threading.Thread(target=self._run_listeners, name="vt-activity-meter", daemon=True).start()

    def _run_listeners(self) -> None:
        try:
            from pynput import keyboard, mouse

            mouse.Listener(on_move=lambda *_: self._on_input(), on_click=lambda *_: self._on_input()).start()
            keyboard.Listener(on_press=lambda *_: self._on_input()).start()
            while True:
                time.sleep(3600)
        except Exception:
            pass

    def score(self) -> int:
        now = time.time() * 1000
        with self._lock:
            if now - self._window_start_ms > ACTIVITY_WINDOW_MS:
                self._input_count = 0
                self._window_start_ms = now
            pct = round(min(100, (self._input_count / ACTIVITY_SATURATION_EVENTS) * 100))
        return max(ACTIVITY_MIN_SCORE, pct)

    def reset(self) -> None:
        with self._lock:
            self._input_count = 0
            self._window_start_ms = time.time() * 1000
