"""Resolve human-readable application names from OS identity signals."""

from __future__ import annotations

import sys
from dataclasses import dataclass

from vt_agent.capture.app_names import (
    DISPLAY_NAME_OVERRIDES,
    app_name_from_title_suffix,
    is_invalid_app_token,
    process_name_to_display,
)


@dataclass(frozen=True, slots=True)
class AppIdentity:
    window_title: str = ""
    process_name: str = ""
    exe_path: str = ""
    app_user_model_id: str = ""
    product_name: str = ""
    file_description: str = ""
    company_name: str = ""
    bundle_display_name: str = ""
    bundle_id: str = ""


def resolve_app_display_name(identity: AppIdentity) -> str:
    if sys.platform == "win32":
        return _resolve_windows(identity)
    if sys.platform == "darwin":
        return _resolve_darwin(identity)
    return _finalize("", identity)


def _resolve_windows(identity: AppIdentity) -> str:
    from vt_agent.capture.win.app_model import display_name_from_aumid

    product_name = identity.product_name
    if _is_generic_product_name(product_name):
        product_name = ""

    candidates = (
        display_name_from_aumid(identity.app_user_model_id),
        product_name,
        identity.file_description,
        process_name_to_display(identity.process_name),
        app_name_from_title_suffix(identity.window_title),
    )
    return _finalize(_first_valid(*candidates), identity)


def _is_generic_product_name(value: str) -> bool:
    text = (value or "").strip().lower()
    if not text:
        return False
    for ch in ("®", "™", "(r)", "(tm)"):
        text = text.replace(ch, "")
    text = " ".join(text.split())
    if text in {"microsoft windows operating system", "microsoft windows"}:
        return True
    return text.startswith("microsoft windows operating system")


def _resolve_darwin(identity: AppIdentity) -> str:
    candidates = (
        identity.bundle_display_name,
        identity.product_name,
        identity.file_description,
        identity.process_name,
        app_name_from_title_suffix(identity.window_title),
    )
    return _finalize(_first_valid(*candidates), identity)


def _first_valid(*values: str) -> str:
    for value in values:
        text = (value or "").strip()
        if not is_invalid_app_token(text):
            return text
    return ""


def _finalize(candidate: str, identity: AppIdentity) -> str:
    text = (candidate or "").strip()
    if is_invalid_app_token(text):
        text = "Unknown"

    override_key = (identity.process_name or "").strip().lower()
    if override_key in DISPLAY_NAME_OVERRIDES:
        return DISPLAY_NAME_OVERRIDES[override_key]

    bundle_key = (identity.bundle_id or "").strip().lower()
    if bundle_key in DISPLAY_NAME_OVERRIDES:
        return DISPLAY_NAME_OVERRIDES[bundle_key]

    aumid = (identity.app_user_model_id or "").strip()
    if aumid:
        for prefix, name in _AUMID_EXE_OVERRIDES.items():
            if aumid.startswith(prefix):
                return name

    return text


# Post-resolution overrides keyed by AppUserModelID prefix (rare exceptions only).
_AUMID_EXE_OVERRIDES: dict[str, str] = {}
