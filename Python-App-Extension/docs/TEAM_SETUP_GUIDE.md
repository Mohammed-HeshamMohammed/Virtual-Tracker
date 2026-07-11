# Virtual Tracker Agent — Setup Guide

This small program runs quietly in the background and records your activity (screenshots, active app, browser URL) **only while your timer is running** on a task. It sends this to your manager's dashboard automatically.

You do **not** need to install Python or anything technical. Just follow the steps below.

## Step 1 — Download
Download the installer your admin sent you:
- Windows: `VirtualTrackerAgent-Setup.exe`
- macOS: `VirtualTrackerAgent.pkg`

## Step 2 — Install
Double-click the file you downloaded and click through the installer (Next → Next → Finish).
- If Windows shows a "protect your PC" warning, click **More info → Run anyway**.
- If macOS blocks it, go to **System Settings → Privacy & Security** and click **Open Anyway**.

The agent will start automatically after install, and every time you turn on your computer — you don't need to open it manually again.

## Step 3 — Sign in (one time only)
A browser window will open asking you to sign in. Use your normal Virtual Tracker email and password (the same one you use at app.myvirtualtracker.com).

Once signed in, look for the Virtual Tracker icon in your system tray (bottom-right on Windows, top-right on Mac). It should say **"Signed in — waiting for timer."**

## Step 4 — macOS only: allow permissions
If you're on a Mac, go to **System Settings → Privacy & Security → Accessibility** and turn on the toggle for the Virtual Tracker agent. Without this, it can't read your active app/browser tab.

## Step 5 — Just work as normal
Go to the dashboard, pick your task, and press **Start Timer**. The agent will automatically detect this and start capturing. You don't need to touch the agent again — it starts and stops with your timer.

## Troubleshooting
| Problem | Fix |
|---|---|
| No tray icon after restart | Open Task Manager (Windows) or Activity Monitor (Mac) and check if "VirtualTrackerAgent" is running. If not, restart your computer. |
| Asked to sign in again | Just sign in — this can happen occasionally, your data isn't lost. |
| Tray says "waiting for timer" even though timer is running | Wait ~5 seconds (it checks every 5s), then contact your admin if it persists. |

Questions? Contact your team admin.
