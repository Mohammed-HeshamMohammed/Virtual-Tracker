# Soft Fix Tracker

An isolated React + Tauri-ready UI project for the Soft Fix Workplace design. It does not modify or import tracking, release, updater, authentication, or backend behavior from the current Virtual Tracker app. Nothing in it calls a real API - every screen runs on local mock data.

## Current scope

The window keeps Windows' own title bar (`decorations: true`), so its minimize / maximize /
close buttons are the real ones and keep everything the system gives them: the Snap Layouts
flyout on hover over maximize, the system menu, double-click to maximize, drag-to-snap. The
Rust shell (`match_title_bar` in `src-tauri/src/lib.rs`) only recolours that bar to the app's
navy on Windows 11, so the native bar and the toolbar under it - the Lounge / Work / Dashboard
switch and Settings - read as one header. Tauri, wry and tao have no way to put the native
caption buttons on the same row as web content, and drawing look-alike buttons would lose
those features; that is why the switch sits directly under the bar rather than in it.

- **Lounge** - the original `Nova Vanguard / #general-orbit` Figma frame: a Coworkers/DM view and a project-channels view (their own toggle, top-left), mission card, crew roster, and the voice/profile dock. Channel switching, squad joining, message composition, mute, and deafen all work locally.
- **Work** - a time-tracking mode restyled from Tauri-App-Extension's real screens into this design system: a project/task picker, a live clock and a timer that actually ticks while "tracking" is on (Start/Pause/Stop), today/week/activity/budget stat tiles, and who else on the team is tracking. The timer only resets when you change project or task - not when you switch mode (see below).
- **Dashboard** - Dashboard-Web's Command Center, copied in structure and wording (sidebar sections, breadcrumb, search, notifications, stat cards, the weekly productivity chart, Project Health) into this app's own styling. Only the Dashboard section is filled in; the other sidebar entries show a placeholder. A floating chat button (bottom right, hover to reveal its label) jumps straight to the Lounge.

All three modes stay mounted at once - switching between them hides and shows, it never remounts - so a running timer, a picked project, a half-open menu, or a scroll position survives the round trip instead of resetting. Every interactive row across both Lounge and Work now shares the same hover/active transition instead of some snapping instantly and others not reacting at all.

## Run the UI

```powershell
npm install
npm run dev
```

Open `http://127.0.0.1:1421/`.

## Build the UI

```powershell
npm run build
```

## Structure

```text
Soft fix Tracker/
├── public/
│   └── assets/
├── src/
│   ├── components/
│   │   ├── work/          Work mode
│   │   ├── dashboard/     Dashboard mode
│   │   ├── AppToolbar.tsx   Mode switch + Settings
│   │   └── ...            Lounge (unchanged) + LoungeShell
│   ├── data/              Mock data per mode
│   ├── App.tsx
│   ├── main.tsx
│   └── styles.css
├── src-tauri/
│   ├── capabilities/
│   ├── src/
│   ├── Cargo.toml
│   └── tauri.conf.json
├── index.html
├── package.json
└── vite.config.ts
```
