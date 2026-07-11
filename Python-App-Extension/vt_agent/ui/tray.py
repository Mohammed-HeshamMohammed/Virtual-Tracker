import threading
import webbrowser
from typing import Callable

import pystray
from PIL import Image, ImageDraw

from vt_agent.core.controller import AgentController

WINDOW_TITLE = "Virtual Tracker Agent"
TRAY_FILL = (75, 226, 119)
TRAY_OUTLINE = (12, 19, 36)


class TrayController:
    def __init__(
        self,
        agent: AgentController,
        on_show: Callable[[], None],
        on_quit: Callable[[], None],
    ) -> None:
        self._agent = agent
        self._on_show = on_show
        self._on_quit = on_quit
        self._icon: pystray.Icon | None = None

    def show(self) -> None:
        if self._icon:
            return
        self._icon = pystray.Icon(
            "VirtualTrackerAgent",
            self._build_image(),
            WINDOW_TITLE,
            menu=pystray.Menu(
                pystray.MenuItem("Show", self._handle_show),
                pystray.MenuItem("Sign in", self._handle_sign_in),
                pystray.MenuItem("Open Virtual Tracker", self._handle_open_app),
                pystray.MenuItem("Quit", self._handle_quit),
            ),
        )
        threading.Thread(target=self._icon.run, name="vt-tray", daemon=True).start()

    def hide(self) -> None:
        if self._icon:
            self._icon.stop()
            self._icon = None

    def _build_image(self) -> Image.Image:
        image = Image.new("RGBA", (64, 64), (0, 0, 0, 0))
        draw = ImageDraw.Draw(image)
        draw.ellipse([8, 8, 56, 56], fill=TRAY_FILL, outline=TRAY_OUTLINE, width=4)
        return image

    def _handle_show(self, icon: pystray.Icon | None = None, item: pystray.MenuItem | None = None) -> None:
        self.hide()
        self._on_show()

    def _handle_sign_in(self, icon: pystray.Icon | None = None, item: pystray.MenuItem | None = None) -> None:
        self._agent.open_sign_in()

    def _handle_open_app(self, icon: pystray.Icon | None = None, item: pystray.MenuItem | None = None) -> None:
        from vt_agent.utils import open_url_in_launcher_or_browser
        open_url_in_launcher_or_browser(self._agent.settings.web_url)

    def _handle_quit(self, icon: pystray.Icon | None = None, item: pystray.MenuItem | None = None) -> None:
        self.hide()
        self._on_quit()

