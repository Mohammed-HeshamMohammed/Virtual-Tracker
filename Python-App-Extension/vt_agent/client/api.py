import time
from typing import Any, Callable

import requests

from vt_agent.client.firebase import FirebaseTokenService
from vt_agent.constants import (
    EVENT_POST_TIMEOUT_SEC,
    EVENT_SOURCE,
    HTTP_TIMEOUT_SEC,
    REGISTER_SOURCE,
    TOKEN_REFRESH_BUFFER_MS,
)
from vt_agent.types import ActivityEvent


class ApiClient:
    def __init__(self, api_url: str) -> None:
        self._api_url = api_url.rstrip("/")
        self._session = requests.Session()
        self._firebase = FirebaseTokenService(self._api_url, self._session)
        self.id_token: str | None = None
        self.refresh_token: str | None = None
        self.on_tokens_refreshed: Callable[[str, str], None] | None = None

    def close(self) -> None:
        self._session.close()

    def set_tokens(self, id_token: str, refresh_token: str = "") -> None:
        self.id_token = id_token or None
        self.refresh_token = refresh_token or None

    @property
    def is_authenticated(self) -> bool:
        return bool(self.id_token)

    def _auth_headers(self) -> dict[str, str]:
        if not self.id_token:
            return {}
        return {"Authorization": f"Bearer {self.id_token}"}

    def refresh_token_if_needed(self) -> bool:
        if not self.id_token:
            return False
        if not self.refresh_token:
            return True
        exp = FirebaseTokenService.id_token_expiry_ms(self.id_token)
        if exp and exp > time.time() * 1000 + TOKEN_REFRESH_BUFFER_MS:
            return True
        refreshed = self._firebase.refresh(self.refresh_token)
        if not refreshed:
            return False
        self.id_token, self.refresh_token = refreshed
        if self.on_tokens_refreshed:
            self.on_tokens_refreshed(self.id_token, self.refresh_token)
        return True

    def fetch_session(self) -> dict[str, Any] | None:
        if not self.refresh_token_if_needed():
            return None
        try:
            res = self._session.get(
                f"{self._api_url}/api/activity/session",
                headers=self._auth_headers(),
                timeout=HTTP_TIMEOUT_SEC,
            )
            if not res.ok:
                return None
            return res.json().get("data")
        except requests.RequestException:
            return None

    def post_events(self, session_id: str, events: list[ActivityEvent]) -> bool:
        if not self.id_token or not events:
            return False
        if not self.refresh_token_if_needed():
            return False
        try:
            res = self._session.post(
                f"{self._api_url}/api/activity/events",
                headers={**self._auth_headers(), "Content-Type": "application/json"},
                json={"sessionId": session_id, "events": events, "source": EVENT_SOURCE},
                timeout=EVENT_POST_TIMEOUT_SEC,
            )
            if not res.ok:
                from vt_agent.log import log

                log.warning("Event upload failed (%s): %s", res.status_code, res.text[:200])
                return False

            payload = res.json() if res.content else {}
            data = payload.get("data") if isinstance(payload, dict) else None
            if isinstance(data, dict):
                skipped = data.get("skipped")
                inserted = data.get("inserted")
                if skipped == "desktop_agent_ingest_disabled":
                    from vt_agent.log import log

                    log.warning(
                        "Server rejected agent events (desktop ingest disabled). "
                        "Ask an admin to set ACTIVITY_DESKTOP_AGENT_INGEST_ENABLED=true and restart the backend."
                    )
                    return False
                if isinstance(inserted, int) and inserted == 0:
                    from vt_agent.log import log

                    by_type = data.get("insertedByType")
                    log.warning(
                        "Server accepted events but inserted 0 rows for session %s (types=%s)",
                        session_id,
                        by_type if isinstance(by_type, dict) else "unknown",
                    )
                    return False
            return True
        except requests.RequestException:
            return False

    def register_agent(self) -> bool:
        if not self.refresh_token_if_needed():
            return False
        try:
            res = self._session.post(
                f"{self._api_url}/api/activity/agent/register",
                headers={**self._auth_headers(), "Content-Type": "application/json"},
                json={"source": REGISTER_SOURCE},
                timeout=HTTP_TIMEOUT_SEC,
            )
            return res.ok
        except requests.RequestException:
            return False

    def create_link_session(self) -> dict[str, str] | None:
        try:
            res = self._session.post(
                f"{self._api_url}/api/activity/agent/link/init",
                headers={"Content-Type": "application/json"},
                json={"source": REGISTER_SOURCE},
                timeout=HTTP_TIMEOUT_SEC,
            )
            if not res.ok:
                return None
            data = res.json().get("data") or {}
            link_token = data.get("linkToken")
            agent_secret = data.get("agentSecret")
            if not isinstance(link_token, str) or not isinstance(agent_secret, str):
                return None
            return {"linkToken": link_token, "agentSecret": agent_secret}
        except requests.RequestException:
            return None

    def exchange_link_session(self, link_token: str, agent_secret: str) -> dict[str, str] | None:
        try:
            res = self._session.post(
                f"{self._api_url}/api/activity/agent/link/exchange",
                headers={"Content-Type": "application/json"},
                json={"linkToken": link_token, "agentSecret": agent_secret},
                timeout=HTTP_TIMEOUT_SEC,
            )
            if res.status_code == 409:
                return None
            if not res.ok:
                from vt_agent.log import log

                log.warning(
                    "Link exchange failed (%s): %s",
                    res.status_code,
                    res.text[:200],
                )
                return None
            data = res.json().get("data") or {}
            id_token = data.get("idToken")
            if not isinstance(id_token, str) or not id_token:
                return None
            refresh = data.get("refreshToken")
            return {
                "idToken": id_token,
                "refreshToken": refresh if isinstance(refresh, str) else "",
            }
        except requests.RequestException:
            return None
