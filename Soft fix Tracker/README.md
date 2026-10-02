# Soft Fix Tracker

An isolated React + Tauri-ready UI project for the Soft Fix Workplace design. It does not modify or import tracking, release, updater, authentication, or backend behavior from the current Virtual Tracker app. Nothing in it calls a real API - every screen runs on local mock data.

## Current scope

The window keeps Windows' own title bar machinery (`decorations: true`), so minimize / maximize /
close are the real buttons and keep everything the system gives them: the Snap Layouts flyout
on hover over maximize, hover / pressed states, the system menu, double-click to maximize,
drag-to-snap. Only those three buttons are Windows'; the rest of the title-bar row is the app's
own header - the Lounge / Work / Dashboard switch and Settings - and its empty space drags the
window.

How (`caption` module in `src-tauri/src/lib.rs`, Windows only): the client area is extended up
over the old title bar (`WM_NCCALCSIZE`), DWM keeps painting the caption buttons and hit-tests
them through `DwmDefWindowProc`, and the web view gets a region with the buttons' rectangle cut
out so they show and receive the mouse instead of the page. A 5px strip along the top is cut
out too and answered as the window's top resize edge. The buttons' size reaches the frontend
through the `caption_inset` command / `caption-inset` event, and `AppToolbar` pads itself
clear of them. If any step fails (no web-view child window, DWM refusing the bounds) the window
stays exactly as Windows made it and the header simply sits under the normal, recoloured
(`match_title_bar`) title bar. Not verified on Windows 10 or on multi-monitor DPI changes.

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
