import base64
import io
import threading
from typing import TYPE_CHECKING

from PIL import Image

from vt_agent.constants import JPEG_QUALITY, MAX_SCREENSHOT_WIDTH

if TYPE_CHECKING:
    import mss


class ScreenCapture:
    """Reuses one MSS instance per thread for faster repeated screenshots."""

    def __init__(self) -> None:
        self._local = threading.local()

    def _mss(self) -> "mss.mss":
        import mss

        if not hasattr(self._local, "instance"):
            self._local.instance = mss.mss()
        return self._local.instance

    def capture_jpeg_data_url(
        self,
        max_width: int = MAX_SCREENSHOT_WIDTH,
        quality: int = JPEG_QUALITY,
    ) -> str:
        image = self._grab_image()
        if image is None:
            return ""

        width, height = image.size
        if width > max_width:
            scale = max_width / width
            image = image.resize((max_width, int(height * scale)), Image.Resampling.LANCZOS)

        buffer = io.BytesIO()
        image.save(buffer, format="JPEG", quality=quality)
        encoded = base64.b64encode(buffer.getvalue()).decode("ascii")
        return f"data:image/jpeg;base64,{encoded}"

    def _grab_image(self) -> Image.Image | None:
        try:
            shot = self._mss().grab(self._mss().monitors[0])
            return Image.frombytes("RGB", shot.size, shot.bgra, "raw", "BGRX")
        except Exception:
            try:
                from PIL import ImageGrab

                return ImageGrab.grab(all_screens=True)
            except Exception:
                return None
