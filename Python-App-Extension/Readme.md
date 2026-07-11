# Virtual Tracker Python Agent

Native desktop agent for **Windows** and **macOS** — **screenshots**, **foreground apps**, and **browser URLs** while the web timer is **Active**.

## Quick start

### Windows

```powershell
cd Python-App-Extension
copy .env.example .env
run.bat
```

### macOS

```bash
cd Python-App-Extension
cp .env.example .env
chmod +x run.sh
./run.sh
```

Or on either platform: `python -m vt_agent`
## Backend

```env
ACTIVITY_DESKTOP_AGENT_INGEST_ENABLED=true
```

Restart the API after changing env vars.

## Project layout

```
Python-App-Extension/
├── main.py                 # Thin entry (delegates to vt_agent)
├── run.bat                 # Windows: venv + install + launch
├── run.sh                  # macOS: venv + install + launch
├── pyproject.toml          # Package metadata
├── requirements.txt
├── scripts/
│   ├── get-browser-url.ps1              # Windows URL via UI Automation
│   └── get-browser-url-macos.applescript # macOS URL via AppleScript / Accessibility
└── vt_agent/
    ├── __main__.py         # CLI entry
    ├── constants.py        # Timing & API limits
    ├── config.py           # Settings from .env
    ├── types.py            # Typed activity events
    ├── log.py              # Structured logging
    ├── auth/
    │   ├── server.py       # Local token callback (:17389)
    │   └── tokens.py       # Token persistence
    ├── client/
    │   ├── api.py          # Activity API (session, events)
    │   └── firebase.py     # Token refresh
    ├── capture/
    │   ├── activity.py     # Mouse/keyboard score
    │   ├── screen.py       # Full-screen JPEG (mss, reused per thread)
    │   ├── window.py       # Foreground app/title (Windows + macOS)
    │   ├── app_identity.py # Display-name resolver (AUMID → metadata → process → title)
    │   ├── browser_detect.py # Browser classification (separate from naming)
    │   ├── app_names.py    # Validation helpers + small override map
    │   ├── win/            # Windows exe metadata + AppUserModelID
    │   ├── darwin/         # macOS bundle Info.plist metadata
    │   ├── browser_url.py  # Platform URL reader
    │   └── events.py       # Event builder
    ├── core/
    │   ├── controller.py   # Wires auth + API + tracker
    │   └── tracker.py      # 5s poll, capture while active
    └── ui/
        ├── app.py          # Main window
        ├── tray.py         # System tray
        └── theme.py        # Colors & copy
```

## Account linking (secure session flow)

1. Agent calls backend `POST /api/activity/agent/link/init` and receives a short-lived `linkToken` + `agentSecret`.
2. Browser opens `/auth?link={linkToken}` (opaque session id — not credentials).
3. User signs in; the web app completes linking via backend `POST /api/activity/agent/link/complete` over HTTPS.
4. Agent polls `POST /api/activity/agent/link/exchange` with `linkToken` + `agentSecret` and receives tokens once.

Local port `17389` is **health-check only** (`GET /health`) — tokens are never posted to localhost from the browser.

## Environment

| Variable | Default |
|----------|---------|
| `VT_API_URL` | `http://localhost:5712` |
| `VT_WEB_URL` | `http://localhost:3000` |
| `VT_AUTH_PORT` | `17389` (health endpoint only) |

## Production

```env
VT_API_URL=https://api.yourdomain.com
VT_WEB_URL=https://app.yourdomain.com
```

Install on **each employee PC**. Do not run alongside the Electron Desktop Agent (same auth port).

## Maintainer build (PyInstaller + installer)

End users should **not** run Python or `run.bat`. Build a packaged agent for distribution:

### Windows

```powershell
cd Python-App-Extension
.\scripts\build-windows.ps1 `
  -ApiUrl "https://dashapi.myvirtualtracker.com" `
  -WebUrl "https://app.myvirtualtracker.com"
```

Produces:
- `dist/VirtualTrackerAgent/` — onedir bundle (faster startup on old HDDs than onefile)
- `dist/VirtualTrackerAgent-Setup.exe` — if [Inno Setup 6](https://jrsoftware.org/isinfo.php) is installed

The installer adds a **Startup folder shortcut** so the agent launches on login.

### macOS

```bash
cd Python-App-Extension
chmod +x scripts/build-macos.sh
VT_API_URL=https://dashapi.myvirtualtracker.com \
VT_WEB_URL=https://app.myvirtualtracker.com \
./scripts/build-macos.sh
```

**Manual steps (require Apple Developer account):**
1. Code-sign the built binary (`codesign --deep --force --sign "Developer ID Application: …"`)
2. Notarize with `notarytool` for Gatekeeper on other Macs
3. Copy `installer/com.virtualtracker.agent.plist` to `~/Library/LaunchAgents/` for auto-start

Production URLs are baked at build time via `.env.production` in the bundle — no secrets, only public API/web URLs.

### Employee-facing install guide

Share `docs/TEAM_SETUP_GUIDE.md` with your team (no command line required).

### Resource notes (low-spec hardware)

| Mode | Typical footprint |
|------|-------------------|
| Idle (waiting for timer) | Low CPU; tray + 5s session poll only |
| Capturing | Periodic `mss` screenshot + JPEG encode — main CPU cost |

If older machines struggle, increase screenshot interval in `vt_agent/constants.py` before building, or lower JPEG quality in `capture/screen.py`.

## Capture behavior

| Feature | Interval |
|---------|----------|
| Session poll | 5s |
| Screenshot | 90–210s (random) |
| App + URL log | 30s |

**URL capture:** Reads the browser **address bar** (not page content).

| Platform | Method | Browsers |
|----------|--------|----------|
| Windows | PowerShell UI Automation | Chrome, Edge, Firefox, Brave, Opera, Opera GX, Vivaldi |
| macOS | AppleScript + Accessibility | Safari, Chrome, Edge, Brave, Opera, Opera GX, Vivaldi, Firefox* |

\*Firefox on macOS uses the toolbar accessibility tree when AppleScript URL APIs are unavailable.

Chromium browsers on Windows may need one focus on the window before the omnibox is readable; the agent calls `AccessibleObjectFromWindow` to enable this.

### macOS permissions

Grant **Accessibility** (and **Automation** when prompted) for Terminal or the packaged agent so it can read the foreground app and browser URL bar. Without this, app names may work but URLs can be empty.

Data appears under **Activity → Screenshots / Apps / URLs**.

### Application naming (Windows)

Display names are resolved in priority order:

1. **AppUserModelID** friendly name (Store/UWP apps — Teams, Terminal, Settings, etc.)
2. **ProductName** from the executable version resource
3. **FileDescription** from the executable version resource
4. **Process name** (e.g. `Code.exe` → `Code`)
5. **Window title suffix** (last resort, with invalid-token filtering)
6. Small **override map** for known exceptions (`code.exe` → VS Code, etc.)

Executable metadata and AppUserModelID strings are cached (invalidated on file mtime change) to keep polling overhead low.
