import os
import sys
from dataclasses import dataclass
from pathlib import Path

PACKAGE_ROOT = Path(__file__).resolve().parent


def _project_root() -> Path:
    if getattr(sys, "frozen", False):
        return Path(getattr(sys, "_MEIPASS", PACKAGE_ROOT.parent))
    return PACKAGE_ROOT.parent


PROJECT_ROOT = _project_root()
SCRIPTS_DIR = PROJECT_ROOT / "scripts"
ENV_FILE = PROJECT_ROOT / ".env"
BUNDLED_ENV_FILE = PROJECT_ROOT / ".env.production"
STORE_FILE = (Path.home() / ".virtualtracker" / "agent-store.json") if getattr(sys, "frozen", False) else PROJECT_ROOT / "agent-store.json"


def _load_env_file(path: Path) -> None:
    if not path.exists():
        return
    for line in path.read_text(encoding="utf-8").splitlines():
        text = line.strip()
        if not text or text.startswith("#") or "=" not in text:
            continue
        key, _, val = text.partition("=")
        key = key.strip()
        val = val.strip().strip('"').strip("'")
        if key and key not in os.environ:
            os.environ[key] = val


def _load_env_file_legacy() -> None:
    _load_env_file(ENV_FILE)
    if getattr(sys, "frozen", False):
        _load_env_file(BUNDLED_ENV_FILE)


@dataclass(frozen=True, slots=True)
class Settings:
    api_url: str
    web_url: str
    auth_port: int
    launcher_url: str
    store_path: Path
    url_script_path: Path
    macos_url_script_path: Path

    @classmethod
    def load(cls) -> "Settings":
        _load_env_file_legacy()
        return cls(
            api_url=os.environ.get("VT_API_URL", "http://localhost:5712").rstrip("/"),
            web_url=os.environ.get("VT_WEB_URL", "http://localhost:3000").rstrip("/"),
            auth_port=int(os.environ.get("VT_AUTH_PORT", "17389")),
            launcher_url=os.environ.get("VT_LAUNCHER_URL", "http://127.0.0.1:17800").rstrip("/"),
            store_path=STORE_FILE,
            url_script_path=SCRIPTS_DIR / "get-browser-url.ps1",
            macos_url_script_path=SCRIPTS_DIR / "get-browser-url-macos.applescript",
        )

    @property
    def agent_auth_url(self) -> str:
        from vt_agent.constants import AUTH_PATH

        return f"{self.web_url}{AUTH_PATH}"


settings = Settings.load()
