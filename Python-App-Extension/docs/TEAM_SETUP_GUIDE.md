# Virtual Tracker Agent — Setup Guide

This small program runs quietly in the background and records your activity (screenshots, active app, browser URL) **only while your timer is running** on a task. It sends this to your manager's dashboard automatically.

You do **not** need to install Python or anything technical. Just follow the steps below.

## Step 1 — Download
Your admin will send you **one file** — you do not need Python or any setup.

- **Windows (recommended):** `VirtualTrackerAgent-Setup.exe`
- **Windows (portable zip):** unzip `VirtualTrackerAgent-Portable.zip` and run `VirtualTrackerAgent.exe`
- **macOS:** `VirtualTrackerAgent.pkg` *(when your admin provides it)*

## Step 2 — Install
Double-click the installer and click **Next → Next → Finish**.

- If Windows shows **“Windows protected your PC”**, click **More info → Run anyway** (the app is not code-signed yet).
- Leave **“Start when Windows starts”** checked — the agent runs in the background automatically.

## Step 3 — Sign in and link (one time only)
1. In the desktop agent, click **Sign In**. Your browser opens to the Virtual Tracker dashboard.
2. Sign in with your normal email and password (same as app.myvirtualtracker.com).
3. On the **Link Virtual Tracker Agent** page, click the green **Link this account** button.
4. When linking succeeds, the agent should show your name and **Signed in — waiting for timer**.

If you only sign in to the dashboard but skip **Link this account**, the agent stays on **Not signed in** and will not capture any activity.

## Step 4 — macOS only: allow permissions
If you're on a Mac, go to **System Settings → Privacy & Security → Accessibility** and turn on the toggle for the Virtual Tracker agent. Without this, it can't read your active app/browser tab.

## Step 5 — Just work as normal
Go to the dashboard, pick your task, and press **Start Timer**. The agent will automatically detect this and start capturing. You don't need to touch the agent again — it starts and stops with your timer.

## Troubleshooting
| Problem | Fix |
|---|---|
| No tray icon after restart | Open Task Manager (Windows) or Activity Monitor (Mac) and check if "VirtualTrackerAgent" is running. If not, restart your computer. |
| Asked to sign in again | Just sign in — this can happen occasionally, your data isn't lost. |
| Agent says Connected but Not signed in | You signed in to the website but did not click **Link this account**. Click **Sign In** (or **Open Link Page**) in the agent, then click **Link this account** in the browser. |
| No screenshots / apps / URLs while timer runs | The agent must show your name (linked). Keep the agent running in the tray while the dashboard timer is active. |
| Dashboard timer keeps counting after closing agent | Normal — the web timer is separate. Stop the timer from the dashboard popup (pause/stop button). |

Questions? Contact your team admin.
