# Team setup — Virtual Tracker desktop agent

You do **not** need to install Rust, Node, or anything technical. Just follow the steps below.

## Install

Your admin will send you **one installer file**.

1. Run the installer (`Virtual Tracker Agent` setup)
2. Launch **Virtual Tracker Agent** from the Start menu (or let it start at login if that option was enabled)
3. Click **Sign In** — your browser opens the Virtual Tracker web app
4. Sign in with your work account and complete **Link this account**
5. Start the tracker timer in the dashboard — the agent will show **Task session active** and begin uploading screenshots / apps / URLs

## Tips

- Closing the window **quits** the agent (tracking stops with it)
- Use the tray icon's **Show** to reopen it, or **Quit** to exit from there instead
- If sign-in fails, check your internet connection and ask an admin that the activity API is up

## Permissions (Windows)

Browser URL capture uses UI Automation via a bundled PowerShell script. No special install steps are normally required.

## Permissions (macOS)

Grant **Accessibility** (and **Automation** when prompted) so the agent can read the foreground app and browser address bar.
