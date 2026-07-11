# Admin: build and share the agent (one-time)

Your team needs **only** `VirtualTrackerAgent-Setup.exe` — no Python, no `.env`, no terminal.

Production URLs are baked in at build time from `production.defaults.env`:
- API: `https://appapi.myvirtualtracker.com`
- App: `https://app.myvirtualtracker.com`

## Prerequisites (your PC only — not the team)

- Windows 10/11
- Python 3.10+ ([python.org](https://www.python.org/downloads/) — check **Add Python to PATH**)
- Optional: [Inno Setup 6](https://jrsoftware.org/isinfo.php) (creates a proper installer)

## Build the installer

```powershell
cd Python-App-Extension
.\scripts\build-windows.ps1
```

Output:
- **`dist\VirtualTrackerAgent-Setup.exe`** ← send this to the team (if Inno Setup is installed)
- **`dist\VirtualTrackerAgent\`** ← folder fallback (zip it if no Inno Setup)

### No Inno Setup?

```powershell
.\scripts\build-windows.ps1 -SkipInstaller
.\scripts\package-windows-zip.ps1
```

Send **`dist\VirtualTrackerAgent-Portable.zip`** instead. Team unzips and runs `VirtualTrackerAgent.exe`.

## Share with the team

1. Upload `VirtualTrackerAgent-Setup.exe` (or the zip) to Google Drive / SharePoint / email.
2. Attach **`docs/TEAM_SETUP_GUIDE.md`** (or export as PDF).
3. Tell them: install → sign in once → start task timer in the dashboard.

## Before the team installs — server checklist

On **Coolify → Dashboard-Backend**:

```env
ACTIVITY_DESKTOP_AGENT_INGEST_ENABLED=true
ACTIVITY_EVENTS_PG_ENABLED=true
POSTGRES_URL=postgres://...
```

Redeploy backend. Verify: `https://appapi.myvirtualtracker.com/health`

## Low-spec PCs

The build uses **onedir** (not onefile) for faster startup on old HDDs. Typical idle use: tray icon + 5s poll only. Capturing adds periodic screenshot encoding.

To reduce load before building, you can increase intervals in `vt_agent/constants.py` (optional).

## Updating later

Change `production.defaults.env` if URLs change, rebuild, and redistribute the new installer.
