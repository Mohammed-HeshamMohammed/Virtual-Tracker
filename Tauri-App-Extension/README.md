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

Custom title bar with **Minimize** and **Close** (quits the app). No maximize. The tray icon still lets you reopen/quit, but closing the window itself now exits the process rather than hiding to tray.

Settings opens as a view inside the same window (no resize, no second window) with a **Back** button in place of the logo; its Close button quits the app the same as the home screen's.
