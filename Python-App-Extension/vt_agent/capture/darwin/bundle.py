"""Read CFBundleDisplayName from macOS .app bundles."""

from __future__ import annotations

import os
import plistlib
import threading
from dataclasses import dataclass
from pathlib import Path

from vt_agent.log import log


@dataclass(frozen=True, slots=True)
class BundleMetadata:
    display_name: str = ""
    bundle_name: str = ""
    bundle_id: str = ""


@dataclass(slots=True)
class _CacheEntry:
    mtime_ns: int
    metadata: BundleMetadata


_cache: dict[str, _CacheEntry] = {}
_cache_lock = threading.Lock()


def get_bundle_metadata(exe_path: str) -> BundleMetadata:
    path = (exe_path or "").strip()
    if not path:
        return BundleMetadata()

    plist_path = _info_plist_for_exe(path)
    if not plist_path:
        return BundleMetadata()

    try:
        mtime_ns = os.stat(plist_path).st_mtime_ns
    except OSError:
        return BundleMetadata()

    key = str(plist_path)
    with _cache_lock:
        cached = _cache.get(key)
        if cached and cached.mtime_ns == mtime_ns:
            return cached.metadata

    metadata = _read_plist(plist_path)
    with _cache_lock:
        _cache[key] = _CacheEntry(mtime_ns=mtime_ns, metadata=metadata)
    return metadata


def _info_plist_for_exe(exe_path: str) -> Path | None:
    path = Path(exe_path).resolve()
    for parent in path.parents:
        if parent.name.endswith(".app"):
            plist = parent / "Contents" / "Info.plist"
            if plist.is_file():
                return plist
            return None
    return None


def _read_plist(plist_path: Path) -> BundleMetadata:
    try:
        with plist_path.open("rb") as handle:
            data = plistlib.load(handle)
        if not isinstance(data, dict):
            return BundleMetadata()
        display = str(data.get("CFBundleDisplayName") or data.get("CFBundleName") or "").strip()
        bundle_name = str(data.get("CFBundleName") or "").strip()
        bundle_id = str(data.get("CFBundleIdentifier") or "").strip()
        return BundleMetadata(display_name=display, bundle_name=bundle_name, bundle_id=bundle_id)
    except Exception as error:
        log.debug("Bundle metadata read failed for %s: %s", plist_path, error)
        return BundleMetadata()
