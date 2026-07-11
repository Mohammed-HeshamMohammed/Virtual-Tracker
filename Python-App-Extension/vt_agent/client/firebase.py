import base64
import json
from typing import Any

import requests

from vt_agent.constants import HTTP_TIMEOUT_SEC
from vt_agent.log import log


class FirebaseTokenService:
    def __init__(self, api_url: str, session: requests.Session) -> None:
        self._api_url = api_url.rstrip("/")
        self._session = session
        self._api_key: str | None = None

    def _firebase_api_key(self) -> str | None:
        if self._api_key:
            return self._api_key
        try:
            res = self._session.get(f"{self._api_url}/api/auth/firebase-config", timeout=HTTP_TIMEOUT_SEC)
            res.raise_for_status()
            config = res.json().get("config") or {}
            key = config.get("apiKey")
            if isinstance(key, str) and len(key) > 10:
                self._api_key = key
                return key
        except requests.RequestException as error:
            log.warning("Firebase config fetch failed: %s", error)
        return None

    @staticmethod
    def id_token_expiry_ms(id_token: str) -> int | None:
        try:
            parts = id_token.split(".")
            if len(parts) < 2:
                return None
            padded = parts[1] + "=" * (-len(parts[1]) % 4)
            payload: dict[str, Any] = json.loads(base64.urlsafe_b64decode(padded))
            exp = payload.get("exp")
            return int(exp) * 1000 if isinstance(exp, (int, float)) else None
        except (ValueError, json.JSONDecodeError):
            return None

    def refresh(self, refresh_token: str) -> tuple[str, str] | None:
        api_key = self._firebase_api_key()
        if not api_key or not refresh_token:
            return None
        try:
            res = self._session.post(
                f"https://securetoken.googleapis.com/v1/token?key={api_key}",
                data={"grant_type": "refresh_token", "refresh_token": refresh_token},
                timeout=HTTP_TIMEOUT_SEC,
            )
            if not res.ok:
                return None
            data = res.json()
            id_token = data.get("id_token")
            next_refresh = data.get("refresh_token") or refresh_token
            if not isinstance(id_token, str) or not id_token:
                return None
            return id_token, str(next_refresh)
        except requests.RequestException as error:
            log.warning("Token refresh failed: %s", error)
            return None
