"""Read AppUserModelID from a window via IPropertyStore (UWP / modern Windows apps)."""

from __future__ import annotations

import ctypes
import re
import threading
from ctypes import (
    HRESULT,
    POINTER,
    Structure,
    WINFUNCTYPE,
    byref,
    c_int,
    c_uint,
    c_uint16,
    c_void_p,
    wintypes,
)
from typing import Final

from vt_agent.log import log

ole32 = ctypes.windll.ole32
propsys = ctypes.windll.propsys
oleaut32 = ctypes.windll.oleaut32

VT_LPWSTR = 31
VT_EMPTY = 0


class GUID(Structure):
    _fields_ = [
        ("Data1", wintypes.DWORD),
        ("Data2", wintypes.WORD),
        ("Data3", wintypes.WORD),
        ("Data4", wintypes.BYTE * 8),
    ]


class PROPERTYKEY(Structure):
    _fields_ = [("fmtid", GUID), ("pid", c_uint)]


class PROPVARIANT(Structure):
    _fields_ = [
        ("vt", c_uint16),
        ("wReserved1", c_uint16),
        ("wReserved2", c_uint16),
        ("wReserved3", c_uint16),
        ("data", c_void_p),
        ("data2", c_uint),
    ]


IID_IPropertyStore = GUID(
    0x886D8EEB,
    0x8CF2,
    0x4446,
    (0x8D, 0x02, 0xCD, 0xBA, 0x1D, 0xBD, 0xCF, 0x99),
)

PKEY_AppUserModel_ID = PROPERTYKEY(
    GUID(
        0x9F4C2855,
        0x9F79,
        0x4F39,
        (0xA8, 0xD0, 0xE1, 0xD4, 0x2D, 0xE1, 0xD5, 0xF3),
    ),
    5,
)

# Friendly names for common AppUserModelIDs (prefix or exact match).
AUMID_DISPLAY_OVERRIDES: Final[dict[str, str]] = {
    "Microsoft.WindowsTerminal": "Windows Terminal",
    "Microsoft.WindowsTerminal_": "Windows Terminal",
    "MicrosoftTeams": "Microsoft Teams",
    "MSTeams": "Microsoft Teams",
    "Microsoft.Outlook": "Outlook",
    "Microsoft.MicrosoftEdge": "Microsoft Edge",
    "MSEdge": "Microsoft Edge",
    "Chrome": "Google Chrome",
    "Firefox": "Firefox",
    "SpotifyAB.SpotifyMusic": "Spotify",
    "Microsoft.WindowsCalculator": "Calculator",
    "Microsoft.WindowsStore": "Microsoft Store",
    "Microsoft.WindowsNotepad": "Notepad",
    "Microsoft.Paint": "Paint",
    "Microsoft.ScreenSketch": "Snipping Tool",
    "MicrosoftWindows.Client.CBS": "Windows Settings",
}

_aumid_display_cache: dict[str, str] = {}
_aumid_display_lock = threading.Lock()
_com_initialized = False
_com_lock = threading.Lock()


def get_app_user_model_id(hwnd: int) -> str:
    if not hwnd:
        return ""
    try:
        _ensure_com()
        store = _open_property_store(int(hwnd))
        if not store:
            return ""
        try:
            return _read_app_user_model_id(store)
        finally:
            _release(store)
    except Exception as error:
        log.debug("AppUserModelID read failed: %s", error)
        return ""


def display_name_from_aumid(aumid: str) -> str:
    key = (aumid or "").strip()
    if not key:
        return ""

    with _aumid_display_lock:
        cached = _aumid_display_cache.get(key)
        if cached is not None:
            return cached

    for prefix, name in AUMID_DISPLAY_OVERRIDES.items():
        if key == prefix or key.startswith(prefix):
            with _aumid_display_lock:
                _aumid_display_cache[key] = name
            return name

    base = key.split("!", 1)[0]
    base = base.split("_", 1)[0]
    name = _pascal_case_to_words(base)
    with _aumid_display_lock:
        _aumid_display_cache[key] = name
    return name


def _pascal_case_to_words(value: str) -> str:
    text = (value or "").strip()
    if not text:
        return ""
    spaced = re.sub(r"(?<=[a-z0-9])(?=[A-Z])|(?<=[A-Z])(?=[A-Z][a-z])", " ", text)
    return re.sub(r"\s+", " ", spaced).strip()


def _ensure_com() -> None:
    global _com_initialized
    with _com_lock:
        if _com_initialized:
            return
        ole32.CoInitialize(None)
        _com_initialized = True


def _open_property_store(hwnd: int) -> c_void_p | None:
    store = c_void_p()
    hr = propsys.SHGetPropertyStoreForWindow(
        wintypes.HWND(hwnd),
        byref(IID_IPropertyStore),
        byref(store),
    )
    if hr != 0 or not store.value:
        return None
    return store


def _release(store: c_void_p) -> None:
    if not store or not store.value:
        return
    vtable = ctypes.cast(store, POINTER(POINTER(c_void_p))).contents
    release = WINFUNCTYPE(c_uint, c_void_p)(vtable[2])
    release(store)


def _read_app_user_model_id(store: c_void_p) -> str:
    vtable = ctypes.cast(store, POINTER(POINTER(c_void_p))).contents
    get_value = WINFUNCTYPE(HRESULT, c_void_p, POINTER(PROPERTYKEY), POINTER(PROPVARIANT))(vtable[5])

    prop = PROPVARIANT()
    hr = get_value(store, byref(PKEY_AppUserModel_ID), byref(prop))
    if hr != 0:
        return ""
    try:
        if prop.vt != VT_LPWSTR or not prop.data:
            return ""
        return ctypes.wstring_at(prop.data).strip()
    finally:
        oleaut32.VariantClear(byref(prop))
