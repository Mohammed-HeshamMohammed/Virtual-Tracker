import json
from pathlib import Path

from vt_agent.log import log


class TokenStore:
    def __init__(self, path: Path) -> None:
        self._path = path

    def load(self) -> tuple[str, str]:
        if not self._path.exists():
            return "", ""
        try:
            data = json.loads(self._path.read_text(encoding="utf-8"))
            id_token = data.get("idToken") if isinstance(data.get("idToken"), str) else ""
            refresh = data.get("refreshToken") if isinstance(data.get("refreshToken"), str) else ""
            return id_token, refresh
        except (OSError, json.JSONDecodeError) as error:
            log.warning("Could not read token store: %s", error)
            return "", ""

    def save(self, id_token: str, refresh_token: str) -> None:
        self._path.write_text(
            json.dumps({"idToken": id_token, "refreshToken": refresh_token}, indent=2),
            encoding="utf-8",
        )

    def clear(self) -> None:
        if self._path.exists():
            self._path.unlink()
