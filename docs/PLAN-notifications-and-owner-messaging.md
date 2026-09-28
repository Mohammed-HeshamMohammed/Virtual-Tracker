# Plan — Owner↔member messaging, pages for web notifications, and a visible update

Three parts, planned together because they share one delivery path (the
notification tables) and one honesty problem: right now the app does things
silently that people need to *see* — a message they never notice, a click that
goes nowhere, an update that looks like a crash.

Status: **implemented** (commits e25894eb, 6876d22f, fe3728cd, a65444de), except C2b, which was deliberately not done - see "Decisions made during the build".

---

## What was asked

**A. Owner↔member messaging.** The Owner — only the Owner — messages a member
from the onboarding surface; it reaches their tracker. Confirmed:

- Per-member action, and multi-select to reach several at once.
- Also appears in the recipient's **web** notifications.
- **Raises a Windows notification**, so it isn't missed while the tracker sits
  in the tray.
- **Two-way**: the member can reply, and the Owner sees the reply.

**B. Web notifications get pages.** Confirmed:

- Every notification opens somewhere relevant (several open nothing today).
- A dedicated Notifications page.
- Links open the **specific item**, not just its section.

**C. A visible update.** When an update happens people should see it happening —
an indicator, ideally download and install progress — instead of the app
vanishing. Plus the install-mode fix for the auto-update failure.

---

## Current state (verified in code)

### Messaging rails already exist

`agent_notifications` ([ensure-lookup-schema.js:717](Dashboard-Backend/src/lib/postgres/ensure-lookup-schema.js:717)) already carries
`recipient_id, type, title, message, read_at, created_by`. The tracker already
polls and renders it (`GET /api/agent-notifications`, `.../read`, `.../read-all`
— [agent-versions/routes.js:92](Dashboard-Backend/src/modules/agent-versions/routes.js:92)). Its only writer today is
the update reminder ([agent-versions/service.js:129](Dashboard-Backend/src/modules/agent-versions/service.js:129)).

Web notifications are separate: `createNotification(db, { recipient_id, type,
title, message, link })` ([notifications/service.js:40](Dashboard-Backend/src/modules/notifications/service.js:40)).

**Windows notifications are already available and already permitted.**
`tauri-plugin-notification` is in `Cargo.toml` and `package.json`,
`notification:default` is granted in capabilities, and
[src/utils/notify.ts](Tauri-App-Extension/src/utils/notify.ts) already wraps permission handling:

```ts
export async function notify(title: string, body: string): Promise<void>
```

So "don't let Windows miss it" is reuse, not new plumbing.

The onboarding surface ([onboarding-modal.tsx](Dashboard-Web/features/members/components/modals/onboarding-modal.tsx)) has a
paginated member list and an existing per-row email reminder. Its versions tab
already knows `supportsAgentInbox` per member — whether that tracker is new
enough to show an inbox message at all.

### Why some notifications open nothing

The bell resolves a link to a page ([notifications-bell.tsx:57](Dashboard-Web/shared/ui/layout/components/topbar/notifications-bell.tsx:57)).
Two distinct faults, both confirmed:

1. **No link at all** on `task_timer_started`, `task_completed`,
   `task_completed_mgmt`, `task_blocked`
   ([task-assignments.js:164](Dashboard-Backend/src/modules/tasks/task-assignments.js:164)) — these resolve to `null`
   and clicking does nothing. Others do have links (budget → `pm-clients` /
   `pm-projects`, first login → `people-members`, activity alerts →
   `activity-screenshots`, `task_in_review` → `timesheets-view`).
2. **Item identity is discarded.** The resolver does `split(/[?#]/)[0]`, and
   navigation is `onNavigate={setActiveItem}` — a bare page id
   ([dashboard-shell.tsx:97](Dashboard-Web/app/dashboard-shell.tsx:97)). So `pm-tasks?task=abc` can only
   open the Tasks page, never that task.

### Why the update looks like a crash

`applyStagedUpdate` ([App.tsx:313](Tauri-App-Extension/src/App.tsx:313)) runs **automatically** the moment
tracking stops ([App.tsx:440](Tauri-App-Extension/src/App.tsx:440)), with no warning. It calls
`install()`, which spawns the Windows installer and then
`std::process::exit(0)` — the app is gone instantly, and the `relaunch()` on the
next line never runs.

The installer then needs **administrator rights**, because
`bundle.windows.nsis.installMode` is `perMachine` (writes to Program Files). If
that elevation is refused or unavailable — normal for employees on managed
machines — the install fails with the app already dead. Nothing restarts it.

Two facts that shape Part C:

- `update.download(onEvent)` **does** report progress: `DownloadEvent` is
  `Started { contentLength }` / `Progress { chunkLength }` / `Finished`
  (`@tauri-apps/plugin-updater` types). The app already calls `download()`
  ([App.tsx:343](Tauri-App-Extension/src/App.tsx:343)) **without** a callback, so the data is there and
  simply unused.
- Install progress **cannot** be shown from inside the app, because the process
  exits the moment the installer starts. That half has to be handled
  differently (below).

---

## Part A — Owner↔member messaging

### A1. Storage: a conversation, not a notification

Notifications are the wrong shape for a two-way thread (one row, one recipient,
a read flag). Two new Postgres tables, per the standing Postgres-first
direction:

```
message_threads
  id, tenant_id, member_id, opened_by, subject,
  created_at, last_message_at, closed_at

thread_messages
  id, thread_id, sender_id, body, created_at, read_at
```

One thread per Owner↔member conversation subject. Notifications stay what they
are — the *signal* that a thread has a new message — and link to the thread.
This keeps replies out of a table whose semantics are "one alert, one read
flag".

`tenant_id` is on the thread so a conversation can never span organizations.

### A2. Backend endpoints

| Endpoint | Who | Does |
|---|---|---|
| `POST /api/messages/threads` | **Owner only** | Opens a thread per recipient, posts the first message, signals each recipient |
| `POST /api/messages/threads/{id}/reply` | Owner **or** that thread's member | Appends a message, signals the other side |
| `GET /api/messages/threads` | Owner (all they opened) / member (their own) | List with unread counts |
| `GET /api/messages/threads/{id}` | Participants only | Messages in order |
| `POST /api/messages/threads/{id}/read` | Participants only | Marks the other side's messages read |

Rules:

- **Owner-only for opening.** `role-hierarchy.js` has `isOwnerOrSuperAdminRole`
  but no Owner-only helper — add `isOwnerRole`. Deliberately narrower than
  every other gate, so it gets its own helper.
- **Recipients filtered to the sender's own tenant in the query**, not assumed.
  Otherwise an Owner could message another organization's members by id.
- Replies are restricted to the thread's two participants. A member can reply
  but cannot open a thread, matching "Owner only" for initiating.
- Caps: subject 160 chars (matches the notification column), body ~2000, and at
  most ~200 recipients per send.
- Every message writes a web notification (`type: 'owner_message'` /
  `'member_reply'`) linking to the thread, plus an `agent_notifications` row
  when the recipient is the member.

### A3. Tracker (desktop)

- New messages arrive through the existing inbox poll — no new transport.
- **Raise a Windows notification** via the existing `notify()` helper when an
  unread message appears, so it's seen with the app in the tray.
- Add a reply box to the message view, posting to the reply endpoint.
- This is the one part of Part A that needs an agent release.

### A4. Web

- Onboarding modal (Owner only): row checkboxes + "select all shown", a
  "Message tracker" composer (subject, body, live recipient count).
- After sending, say plainly who won't see it in-tracker:
  "Sent to 5. 2 have an older tracker and will only see this in the web app."
- A Messages view for reading replies — a tab on the Notifications page from
  Part B, rather than a separate destination.

---

## Part B — Pages for web notifications

### B1. Carry the item through navigation

Replace `notificationPageId(link): string | null` with
`notificationTarget(link): { pageId, params } | null` — same tolerance for the
historical link shapes (`/?page=x`, `/people/members`, `people-members`), but
**stop discarding the query**.

`onNavigate` becomes `(pageId, params?)`; `dashboard-shell` keeps params beside
`activeItem` and passes them through `PageContent`. Pages that don't care ignore
them. First consumers: Tasks, Members, Screenshots. The extra argument is
optional, so existing callers compile and behave identically.

### B2. A destination for every type

| Type | Opens |
|---|---|
| `task_timer_started`, `task_completed`, `task_completed_mgmt`, `task_blocked` | that task |
| `task_in_review` | `timesheets-view` (unchanged) |
| budget alerts | that client / project |
| `member_first_login`, `account_deactivation_request` | that member |
| activity alerts | that member's captures |
| `owner_message`, `member_reply` (new) | that thread |

Rows already in the database keep their existing link and still resolve to a
section — no backfill migration.

### B3. The Notifications page

Nav entry (which also makes it a valid link target), full list with unread
first, filters by read/unread and type, pagination, mark-all-read, and rows that
navigate exactly as the bell does. Plus the **Messages** tab from A4. Backend:
extend `listNotificationsForMember` (today `limit = 30`, no paging or filters)
with offset/limit, filters and a total. The bell gets a "See all" link.

---

## Part C — A visible, survivable update

### C1. Show the update instead of vanishing

Today: tracking stops → install → process exits. No warning.

Proposed sequence, all in the app's own UI:

1. **Downloading** — a real progress bar, driven by the `download(onEvent)`
   callback that already exists and is currently ignored. *(Straightforward —
   this is the part you asked if it'd be hard: it isn't.)*
2. **Ready to update** — "Update 1.0.27 is ready. Restarting in 10s."
   with **Restart now** and **Not now**. This is the indicator that replaces the
   silent disappearance. "Not now" defers to the next safe moment.
3. **Installing** — the app is gone by definition here, so this cannot be the
   app's own UI. Instead the NSIS installer's own passive progress window is
   what the user sees, and the message in step 2 sets the expectation that it
   will happen.
4. **Back up** — after relaunch, a brief "Updated to 1.0.27" confirmation, so
   the round trip visibly completed.

So: download progress and a clear pre-install indicator are easy and worth
doing; a true in-app "installing…" view is not possible, and step 2 plus the
installer's own window is the honest substitute.

### C2. Stop updates that can't succeed from killing the app

Two options, from the earlier discussion. **Recommended: do both.**

**C2a — Guard (small, immediate).** Before calling `install()`, check whether
the installer can actually run: is the app installed per-machine, and does this
user have the rights to elevate? If not, do **not** install. Show "Update ready
— needs an administrator" and keep tracking. Nothing exits into a failure.
This alone turns a dead agent into a visible prompt.

**C2b — Per-user install (the real fix).** Switch
`bundle.windows.nsis.installMode` to `currentUser` so the app lives in the
user's own AppData, like Chrome and Slack. Updates then need no elevation ever
and this class of failure disappears.

The catch, stated plainly: **leaving Program Files needs elevation once.** The
migrating installer has to remove the old per-machine copy, and that itself
requires admin. The existing `installerHooks`
([installer-hooks.nsh](Tauri-App-Extension/src-tauri/windows/installer-hooks.nsh)) already does exactly this
shape of migration for the product rename, so the mechanism is proven — but that
one release must be installed with admin rights (by IT, or by the user
accepting one prompt). After it, updates are silent forever.

### C3. The "older versions in the future" case

This is the part that needs saying clearly:

**A fix to the updater only helps updates made *from* a version that already has
the fix.** Anyone on 1.0.25/1.0.26 runs the *old* broken flow for their next
update, no matter what we ship — their installed copy is what performs it. So:

- The next release is the last one that can hurt people on current versions.
  After they're on it, they're safe.
- To avoid a mass breakage on that hop, **withhold the auto-update from
  versions that predate the fix** and surface them in the dashboard's existing
  Agent Versions view as "needs a manual reinstall", with a download link.
  The update endpoint already receives `{current_version}`
  (`/api/agent/update/{target}/{arch}/{current_version}`), so it can decide
  per version — no agent change required to gate it.
- Going forward (1.0.27, 1.0.30, whatever), the same endpoint keeps serving
  everyone on a fixed version normally.

---

## Testing

- **Backend:** Owner-only gate (a Super Admin must be refused from opening a
  thread), tenant filtering of recipients, reply restricted to participants,
  caps, and the notification-link table in B2.
- **Web:** `notificationTarget` across every historical link shape, including
  that the item id now survives — the bug being fixed.
- **Agent:** reply posting, native notification fires once per unread message
  (not per poll), download-progress reducer.
- **Browser:** compose → send → reply round trip; a notification of each type
  opening the right item; Notifications page filters.
- **Manual, on Windows:** the update path. This cannot be verified here and
  must be tested on a real machine, both as an admin and as a standard user,
  before any release.

---

## Sequencing

1. **C2a + C1** — the update guard and the visible download/restart indicator.
   Highest urgency: it stops agents dying. Needs an agent release.
2. **A1-A2** — messaging tables and endpoints. No UI yet.
3. **A4 + B3** — the onboarding composer and the Notifications page (with its
   Messages tab).
4. **A3** — tracker reply box and Windows notification. Second agent release.
5. **B1 + B2** — parameterised navigation, then links for every type.
6. **C2b** — per-user install migration, deliberately last and on its own, so it
   isn't entangled with anything else when it needs one elevated install.

---

## Decisions already made

- Owner only opens threads; members may reply but not initiate.
- Messages go to tracker, web bell, and a Windows notification.
- No email for these — the onboarding reminder already covers email.

## Decisions made during the build

- **C2a only; C2b (per-user install) deliberately not done.** C2a already
  removes the harm: the agent never exits into an install that cannot succeed.
  C2b buys silent updates on locked-down machines, but it costs one elevated
  install to migrate out of Program Files, it cannot be tested anywhere in this
  repo, and a half-migrated machine ends up running two copies - the exact
  failure the rename hook exists to prevent. It also weakens the product: a
  per-user install in AppData is far easier for a monitored employee to remove
  than one in Program Files that needs an administrator. That is a product
  decision, not a cleanup, so it stays unbuilt and on the table.
- **C3 gating is live**: agents below 1.0.27 are served no update. They keep
  running; they need a manual reinstall to rejoin the update stream.

## Still open

- **C2b**, if per-machine installs on locked-down machines turn out to be
  common enough that "update ready, needs an administrator" is a real blocker.
- **Old installs** stay on their current version until someone reinstalls
  them. The Agent Versions view is where they show up.
