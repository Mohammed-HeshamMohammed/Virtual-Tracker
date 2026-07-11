"""Read ProductName / FileDescription from Windows PE version resources."""

from __future__ import annotations

import ctypes
import os
import threading
from ctypes import POINTER, byref, c_uint, c_uint16, c_void_p, create_string_buffer
from dataclasses import dataclass
from typing import Final

from vt_agent.log import log

_VERSION = ctypes.windll.version

_STRING_FIELDS: Final[tuple[str, ...]] = (
    "ProductName",
    "FileDescription",
    "CompanyName",
    "OriginalFilename",
    "InternalName",
)


@dataclass(frozen=True, slots=True)
class ExeMetadata:
    product_name: str = ""
    file_description: str = ""
    company_name: str = ""
    original_filename: str = ""
    internal_name: str = ""


@dataclass(slots=True)
class _CacheEntry:
    mtime_ns: int
    metadata: ExeMetadata


_cache: dict[str, _CacheEntry] = {}
_cache_lock = threading.Lock()


def get_exe_metadata(exe_path: str) -> ExeMetadata:
    path = (exe_path or "").strip()
    if not path or not os.path.isfile(path):
        return ExeMetadata()

    try:
        mtime_ns = os.stat(path).st_mtime_ns
    except OSError:
        return ExeMetadata()

    with _cache_lock:
        cached = _cache.get(path)
        if cached and cached.mtime_ns == mtime_ns:
            return cached.metadata

    metadata = _read_exe_metadata(path)
    with _cache_lock:
        _cache[path] = _CacheEntry(mtime_ns=mtime_ns, metadata=metadata)
    return metadata


def _read_exe_metadata(path: str) -> ExeMetadata:
    try:
        size = _VERSION.GetFileVersionInfoSizeW(path, None)
        if not size:
            return ExeMetadata()

        buffer = create_string_buffer(size)
        if not _VERSION.GetFileVersionInfoW(path, 0, size, buffer):
            return ExeMetadata()

        translation = _query_translation(buffer)
        if not translation:
            return ExeMetadata()

        lang, codepage = translation
        subdir = f"\\StringFileInfo\\{lang:04x}{codepage:04x}\\"
        values = {
            field: _query_string(buffer, subdir + field)
            for field in _STRING_FIELDS
        }
        return ExeMetadata(
            product_name=values["ProductName"],
            file_description=values["FileDescription"],
            company_name=values["CompanyName"],
            original_filename=values["OriginalFilename"],
            internal_name=values["InternalName"],
        )
    except Exception as error:
        log.debug("Exe metadata read failed for %s: %s", path, error)
        return ExeMetadata()


def _query_translation(buffer) -> tuple[int, int] | None:
    value_ptr = c_void_p()
    length = c_uint()
    if not _VERSION.VerQueryValueW(
        buffer,
        r"\VarFileInfo\Translation",
        byref(value_ptr),
        byref(length),
    ):
        return None
    if length.value < 4:
        return None
    data = ctypes.cast(value_ptr, POINTER(c_uint16 * (length.value // 2))).contents
    return int(data[0]), int(data[1])


def _query_string(buffer, subblock: str) -> str:
    value_ptr = c_void_p()
    length = c_uint()
    if not _VERSION.VerQueryValueW(buffer, subblock, byref(value_ptr), byref(length)):
        return ""
    if not value_ptr.value:
        return ""
    try:
        return ctypes.wstring_at(value_ptr.value).strip()
    except OSError:
        return ""
