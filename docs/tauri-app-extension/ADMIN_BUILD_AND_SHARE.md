# Admin: build and share the desktop agent

Your team needs **only** the NSIS/MSI installer from `tauri build` — no Rust, no Node, no `.env`, no terminal.

## Prerequisites (admin machine)

- Node.js 18+
- Rust stable ([rustup](https://rustup.rs/))
- Windows: Visual Studio Build Tools (C++), WebView2

## Build

```powershell
cd Tauri-App-Extension
.\scripts\build-windows.ps1
```

Defaults to:

- API: `https://appapi.myvirtualtracker.com`
- Web: `https://app.myvirtualtracker.com`

Output:

- `src-tauri/target/release/Virtual Tracker Agent.exe`
- `src-tauri/target/release/bundle/nsis/` or `msi/` installer

## Backend checklist

```env
ACTIVITY_DESKTOP_AGENT_INGEST_ENABLED=true
```

Restart the dashboard/activity API after changing env.

## Share with the team

1. Upload the installer to a shared drive or send it directly
2. Share `docs/TEAM_SETUP_GUIDE.md`
3. Do **not** run this agent alongside an Electron desktop agent on the same PC (same local auth port `17389`)
