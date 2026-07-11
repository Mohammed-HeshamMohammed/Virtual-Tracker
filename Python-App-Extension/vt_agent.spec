# -*- mode: python ; coding: utf-8 -*-
# PyInstaller spec — Virtual Tracker desktop agent (onedir, windowed).
# Build via scripts/build-windows.ps1 or scripts/build-macos.sh

import os
from pathlib import Path

block_cipher = None
project_root = Path(SPECPATH)
pkg_root = project_root / "vt_agent"

api_url = os.environ.get("VT_API_URL", "https://appapi.myvirtualtracker.com")
web_url = os.environ.get("VT_WEB_URL", "https://app.myvirtualtracker.com")
auth_port = os.environ.get("VT_AUTH_PORT", "17389")

# Bake production URLs into the bundle (no secrets — public endpoints only).
env_lines = [
    f"VT_API_URL={api_url}",
    f"VT_WEB_URL={web_url}",
    f"VT_AUTH_PORT={auth_port}",
]
(project_root / "dist-build" / ".env.production").parent.mkdir(parents=True, exist_ok=True)
(project_root / "dist-build" / ".env.production").write_text("\n".join(env_lines) + "\n", encoding="utf-8")

datas = [
    (str(project_root / "dist-build" / ".env.production"), "."),
    (str(project_root / "scripts" / "get-browser-url.ps1"), "scripts"),
    (str(project_root / "scripts" / "get-browser-url-macos.applescript"), "scripts"),
    (str(pkg_root / "ui" / "gui"), "vt_agent/ui/gui"),
    (str(pkg_root / "ui" / "gui" / "app-icon.ico"), "vt_agent/ui/gui"),
]

hiddenimports = [
    "mss",
    "mss.windows",
    "PIL",
    "PIL.Image",
    "requests",
    "pystray",
    "pystray._win32",
    "webview",
    "psutil",
    "pynput",
    "vt_agent.capture.win.metadata",
    "vt_agent.capture.win.app_model",
    "vt_agent.capture.darwin.bundle",
]

a = Analysis(
    [str(project_root / "main.py")],
    pathex=[str(project_root)],
    binaries=[],
    datas=datas,
    hiddenimports=hiddenimports,
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[],
    win_no_prefer_redirects=False,
    win_private_assemblies=False,
    cipher=block_cipher,
    noarchive=False,
)

pyz = PYZ(a.pure, a.zipped_data, cipher=block_cipher)

exe = EXE(
    pyz,
    a.scripts,
    [],
    exclude_binaries=True,
    name="VirtualTrackerAgent",
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=False,
    console=False,
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
    icon=str(pkg_root / "ui" / "gui" / "app-icon.ico"),
)

coll = COLLECT(
    exe,
    a.binaries,
    a.zipfiles,
    a.datas,
    strip=False,
    upx=False,
    upx_exclude=[],
    name="VirtualTrackerAgent",
)
