# Virtual Tracker Tauri Agent

Native desktop agent for **Windows** and **macOS** — screenshots, foreground apps, and browser URLs while the web timer is **Active**.

Built with **Tauri 2** (Rust) + **React TypeScript**. Packaged builds always talk to production.

## Production endpoints

| Role | URL |
|------|-----|
| Dashboard | `https://app.myvirtualtracker.com` |
| API | `https://appapi.myvirtualtracker.com` |

Release builds ignore local `.env` and use these URLs.

## Production build (recommended)

```powershell
cd Tauri-App-Extension
npm install
npm run production
```

Or:

```powershell
.\scripts\build-windows.ps1
```

Installer / binaries: `src-tauri/target/release/bundle/`

## Local UI work (still hits production APIs)

```powershell
cd Tauri-App-Extension
copy .env.example .env
npm install
npm run tauri:dev
```

## Backend requirement

```env
ACTIVITY_DESKTOP_AGENT_INGEST_ENABLED=true
```

## In-app settings

Gear icon opens settings inside the agent (not an external launcher):

- Launch at login
- Start hidden in tray
- Auto sign-in
- Read-only connection URLs

## Window chrome

Custom title bar with **Minimize** and **Close** (hides to tray). No maximize.
