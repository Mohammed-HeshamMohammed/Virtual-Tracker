# Virtual Tracker — What the App Actually Does Today

A plain-language guide to every feature that is built and working right now, plus an honest look at what's still in progress. Verified directly against the application's code, not documentation.

---

## Signing In & Account Management

*How people get into the app and manage their account.*

- **Email & Password Login** — People sign in with their email and password, and the app keeps them securely signed in. `Firebase-backed auth with session-cookie issuance and token verification`
- **Guided First Login** — The first time someone logs in, the app walks them through setting up their profile and photo. `Profile completion, profile sync, avatar upload`
- **Suspicious Login Alerts** — If an account is signed into from a new device or location, the owner gets an email heads-up.
- **Welcome & Verification Emails** — New accounts get a welcome email and a link to verify their email address.
- **Password Rules** — The app enforces password strength requirements and checks how an account is allowed to sign in. `/password-policy`, `/resolve-sign-in-methods`, `/validate-password`
- **Deactivating an Account** — An account can be switched off so someone who's left can no longer log in.

## Desktop App Setup & Device Connection

*How the desktop time-tracking app connects to a person's account.*

- **Connecting the Desktop App** — A one-time setup step links the desktop tracking app to a person's account, so it knows whose time it's tracking. `link/init → link/complete → link/exchange`
- **Device Recognition & Re-verification** — Once connected, the app remembers the device and re-checks it if something changes. `/agent/device/register`, `/agent/reauth`, `/agent/register`
- **"Still Running" Check-ins** — The desktop app periodically checks in with the server so the system knows it's active. `/agent/status heartbeat`
- **Secure Local Storage** — Login details saved on the desktop app are protected using Windows' built-in secure storage. `Windows DPAPI-backed token storage`

## Time Tracking & Screenshots

*The core time-tracking feature: starting a session, capturing activity, and keeping records.*

- **Start/Stop Tracking** — Employees can start and stop a tracked work session right from the desktop app.
- **Activity Logging** — While tracking is on, the app records activity in the background and sends it to the server.
- **Automatic Screenshots** — Screenshots are captured during tracked sessions, stored securely, and only viewable by people with permission. `Uploaded to Google Cloud Storage; retrieval requires authentication`
- **Activity Feed** — Managers can see a feed of recent tracked activity for their team or project.
- **Usage Limits** — The system checks and enforces company-wide tracking limits.
- **Cleanup of Forgotten Sessions** — If someone forgets to stop tracking, the system automatically closes the session after a while.
- **Budget Warnings** — If tracked hours push a project over its budget, the right people are notified automatically.
- **Automatic Screenshot Cleanup** — Older screenshots are archived and eventually removed on a schedule to save space. `3-week active window, 7-day archive`

## Online Status

*Knowing who's around right now.*

- **Who's Online** — See at a glance which team members are currently online or away, updated in real time. `Redis/RTDB pub-sub, streamed over SSE`

## Projects

*Setting up and running projects.*

- **Creating & Managing Projects** — Add, edit, and organize projects, each with its own overview dashboard.
- **Linking Teams to Projects** — Assign a whole team to a project at once.
- **Linking Clients to Projects** — Connect a project to the client it's being done for.
- **Managing Project Members** — Add or remove specific people from a project.
- **Limiting Project Size** — Set a cap on how many people can be assigned to a project.
- **Project Budgets** — Set a budget for a project, track how much of it has been used, and get notified as it nears the limit.

## Clients & Budgets

*Managing the companies or people being billed.*

- **Managing Clients** — Add, edit, and remove clients, with a detailed view for each one.
- **Client Budgets** — Set up hourly, fixed, or retainer-style budgets per client — for one person, one project, or the whole account — with automatic notifications and resets.
- **Invoicing Settings** — Configure how a given client should be invoiced.

## Tasks & To-Dos

*Breaking work down and tracking who's doing what.*

- **Creating & Managing Tasks** — Add, edit, and view individual tasks.
- **Reordering Tasks** — Drag and drop tasks into the order that makes sense.
- **Assigning Work** — Assign tasks to people and see who's working on what.
- **Assignment Review Queue** — A review step for task assignments before they're finalized, with the option to reassign.
- **Tracking Time on Tasks** — Time individual tasks, with limits so a person can't run multiple timers at once.
- **Progress Tracking** — See how far along a task or a person's overall workload is.
- **Logging Hours** — Manually log or correct hours spent on a task.
- **Multiple Views** — See tasks as a board, a list, or a calendar timeline — whichever fits how someone thinks about their work.

## Team Members & Invitations

*Managing the people in the system.*

- **Managing People** — Add, edit, remove, and look up team members.
- **Bulk Actions** — Update or remove many members at once instead of one by one.
- **Member Activity History** — See a log of changes made to a member's record over time.
- **Inviting People** — Send a single invite or invite a whole batch of people at once; invited people accept through a link.
- **Banning Members** — Block a member's access to the app if needed.
- **Changing Roles** — Promote someone or change their role and permissions.
- **Automatic Employee IDs** — The system automatically assigns an employee ID to new hires.
- **Custom Profile Fields** — Organizations can add their own custom fields to member profiles.

## Company Org Chart

*Understanding who reports to whom.*

- **Visual Org Chart** — See the reporting structure laid out as a tree, including who reports to whom.
- **Reporting-Line Lookups** — Quickly check whether one person is above or below another in the chain of command.
- **Shared Teams & Projects** — See which members share a team or are working on the same projects.
- **Requesting a Transfer** — Request to move someone to a new manager or team; the move is confirmed through an approve/decline link.
- **Moving People Directly** — Move a member to a new manager immediately, without the request step.
- **Fixing Broken Links** — Detect and repair org-chart entries that became disconnected.
- **Rebuilding the Org Chart** — Reset or rebuild the entire reporting structure if it's ever needed.

## New Hire Onboarding

*Getting new people set up.*

- **Onboarding Checklist** — Track where a new hire is in the onboarding process.
- **Reminders** — Send a nudge to someone who hasn't finished onboarding yet.
- **Setting Up Onboarding** — Bootstrap onboarding records for new members automatically.

## Teams

*Grouping people into teams.*

- **Team Rosters** — See who belongs to each team.
- **Automatic Weekly Reports** — The system generates a weekly report for each team on its own.

## Notifications & Alerts

*Keeping people informed.*

- **In-App Notifications** — See, read, and clear notifications right inside the app.
- **First-Login Welcome Notice** — New users get a notification the first time they log in.
- **Email, Text & Push Alerts** — Notifications can also be delivered by email, text message, or push notification, not just in-app.

## Main Dashboard

*The home screen when someone opens the app.*

- **Command Center** — A single dashboard that pulls together the most important information across the whole app.
- **General Overview** — A simpler, general-purpose dashboard view.
- **Fast App Startup** — The app pre-loads key data in the background so it opens quickly.

## Internal Data Management Tools

*Tools for administrators, not regular users.*

- **Behind-the-Scenes Data Tools** — Administrators can directly manage the app's underlying data — clients, projects, members, tasks, teams, timesheets — when something needs a manual fix.

## Public Website

*The marketing website, separate from the app itself.*

- **Contact Form** — Visitors to the marketing site can send a message, which is emailed to the team.
- **Shared Login Status** — The marketing site and the main app stay in sync on whether someone is logged in.

## Internal Admin Tools

*Tools used by the team running the system, not by customers.*

- **Admin Monitoring Dashboard** — A password-protected internal page the team uses to keep an eye on system health.

---

## What's Coming Next

These are visible in the app already, but not finished. Some are waiting on a design decision, some just need the back-end work to catch up to a screen that's already built. Listed here so it's clear what's in progress versus what's actually done.

- **Sign In With a Work Email (SSO)** — The screen for this is fully designed and built, but it's switched off until a company sign-in system (like Google or Microsoft login) is connected on the back end. `Flag: WORK_EMAIL_LOGIN_ENABLED = false`
- **"Request Access" Screen** — The screen is built, but there's no back-end process yet to receive and handle access requests. `Flag: REQUEST_ACCESS_ENABLED = false`
- **Import/Export for Team Members** — The toggle for this exists in settings, but bulk import/export isn't built on the back end yet — adding many people today goes through the invite feature instead. `Flag: MEMBER_IMPORT_EXPORT_ENABLED = false`
- **Import/Export for Projects** — Same situation as members: the setting exists, but the underlying bulk import/export isn't built yet. `Flag: PROJECT_MANAGEMENT_IMPORT_EXPORT_ENABLED = false`
- **Timesheet Approval Requirement** — A toggle for requiring manager approval on timesheets is visible in settings, but it's for preview only right now — turning it on doesn't do anything yet.
- **Shift Scheduling & Pay Rates** — Screens for setting shift schedules and pay/bill rates per member exist, but aren't connected to any real data yet.
- **One Project Setting** — A single settings field inside project setup is visible but turned off, marked as coming soon.
- **Billing: Invoices, Expenses, Payments, Payroll** — This whole section is fully designed and built — creating invoices, logging expenses, recording payments, adjusting payroll — but none of the screens are connected to real data yet. This is a case of the design work being ahead of the back-end work, not a missing idea.
- **Reports** — Eight different report types are fully designed (amounts owed, time & activity, manual time edits, work breaks, audit log, daily totals, project budgets, work sessions), with filters, charts, and export options all built. Like Billing, they aren't yet connected to real data. Most of the underlying information already exists elsewhere in the app, so connecting these is mainly about adding the right endpoints, not building new data from scratch.
- **Time Off** — This is an early placeholder page only. Nothing has been designed or built here yet.
