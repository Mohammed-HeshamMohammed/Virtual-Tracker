# Plan — Timers that stop when nobody asked: prevention, recovery, traceability

**Status:** **Implemented 2026-09-11**, with one architectural change that made several items
unnecessary. See [Implementation status](#implementation-status) directly below. The agent-side
items (C1, C3, D2, D4) need an agent release to reach users; everything else ships with the backend
and web deploys.
**Date:** 2026-09-11
**Scope:** `Dashboard-Backend`, `Dashboard-Web`, `Tauri-App-Extension`

## Implementation status

### The change that reshaped the plan

The top-bar **Start** button is now navigation only: it opens Tools and does nothing else. That
button turned out to be the *only* caller of `requestActivityRuntime`, the one thing that ever
switched on the dashboard's timer runtime ("adopt"). Every dashboard path that paused the agent's
timer lived inside that runtime, or next to it (`ActivitySessionGuard`). With the button stripped
and the guard deleted, **nothing in the dashboard can start, pause or stop a timer, and nothing can
raise the "Start the Virtual Tracker Agent…" toast.** The agent owns the timer, and the server
enforces it.

### Item by item

| Item | Outcome |
|---|---|
| A1 guard pauses on every load | **Done** — `ActivitySessionGuard` deleted |
| A2 session poll re-pauses | **Moot** — lives in the runtime, which no longer mounts |
| A3 three-state readiness | **Done** — server `getAgentPresence` (online / offline / unknown), `agentOnline: null` when Redis cannot answer, session row as a second witness; web `agentPresence` |
| A4 60s absence window | **Moot for the dashboard**, which no longer pauses. Server presence TTL is 60s |
| A5 sign-out stops the timer | **Done** — `logout()` no longer posts `stop`, and the server refuses it anyway |
| A6 web idle watch on unknown mode | **Moot** — inside the dormant runtime |
| A7 one decision point | **Done, stronger** — zero dashboard decision points |
| A8 refreshes read-only | **Done** — `test/timer-stop-contract.test.mjs` fails if a page reaches the timer |
| New: server ownership guard | **Done** — `routes.js` refuses dashboard `idle` / `stop` / `resume` / `sync` on agent sessions (`isWebActionOnAgentSession`). Covers tabs still on old code until they reload |
| B1–B4 truthful toast | **Moot** — nothing dispatches it any more. The Tools page no longer says "on this device" or "start from the topbar", and shows "Checking…" when status is unknown |
| C1 agent survives a pause | **Done** — keeps session, task and totals; paused ticks credit nothing; resuming credits none of the pause. *Needs agent release* |
| C2 auto-resume | **Moot** — nothing issues `agent_absent` pauses: the dashboard can't, and the server refuses old tabs |
| C3 recovery marked | **Done** — `recovered_after_reap`. *Needs agent release* |
| D1 reason columns | **Done** — `stop_reason`, `stopped_by`, `pause_reason`, `paused_at` |
| D2 reason on every action | **Done** — server validates and records it; agent sends it from all 12 call sites. *Agent part needs release* |
| D3 session history | **Done** — `activity_session_events`, a row per start / pause / resume / stop / refused request |
| D4 agent version | **Done** — `X-Agent-Version` on session actions. *Needs agent release* |
| D5 show it | **Done** — Work Sessions shows the reason under the stop time, and in CSV / PDF exports |
| New: task deletion stops its timer | **Done** — server-side in `deleteTaskPg`, recorded as `task_deleted`. This replaces the dashboard handler that only ran when its runtime happened to be on |
| E1 counts by reason | **Done via D3**: reasons are queryable; the reap still records its security event |
| E2 false-pause metric | **Moot** — no dashboard pauses to count |
| E3 heartbeat-gap log | **Done** — every check-in measures the gap since the last one in the same round trip (`SET … GET` on Redis ≥ 6.2; `MULTI GETSET + EXPIRE` on older, detected once). A gap over half the TTL (30s) is logged and recorded as `agent_heartbeat_gap` |
| F1 web tests | **Done** — dependency-free `node --test` contract suite (`npm test`) |
| F2 backend tests | **Done** — reasons, ownership, presence, history, task deletion |
| F3 agent tests | **Done** — pause keeps session, resume credits no pause, reason and version sent |
| F4 cadence contract | **Done** — the TTL test reads the agent's constants from its source when present |

### Decisions (§5) as applied

- **D-1:** A restriction never stopped the timer through the web; it signs out via `firebaseSignOut`
  directly. The restricted account's agent stops once the server rejects its requests, and the stop
  is recorded as `abandoned_reap`.
- **D-2:** Not needed. C2 is moot.
- **D-3:** 60s. That's the server's presence TTL. The dashboard no longer counts at all.
- **D-4:** Yes — dashboard sign-out leaves the agent's timer running.

### Reading a stop now

```sql
SELECT created_at, action, reason, source, client_version
FROM activity_session_events
WHERE member_id = $1 AND created_at BETWEEN $2 AND $3
ORDER BY created_at;
```

`reason` answers "why did it stop". `source = 'web'` with `action = 'ignored'` marks a tab on old
code that tried to drive the timer and was refused.

---

## The situation

A member's timer ends or pauses without them asking. Reports so far:

- **"The tracking stopped on its own"**: 100% activity, seconds of idle, stopped clock.
- **"Pressing Refresh on the Activity → Screenshots page stopped the timer"**, with the dashboard
  toast *"Start the Virtual Tracker Agent on this PC, then try again. Timer paused until the agent
  reconnects"* while the agent was visibly running.

What this plan is for, in priority order:

1. **Prevent.** Nothing stops or pauses a timer except a deliberate action by the member, or the
   agent being genuinely and verifiably absent.
2. **Recover.** When something does stop a timer, no worked time is lost and tracking resumes.
3. **Trace.** Every stop and pause records who did it and why, so "it stopped on its own" can be
   answered from data rather than reconstructed from code.
4. **Tell the truth.** Every message shown to the member describes what actually happened.

Item 3 matters most for the long run. Today no stop records its cause, so every report starts a
fresh investigation.

### The rule for dashboard interactions

**Using the dashboard never stops, pauses or disconnects a timer, and never shows an agent or
connection error because of the use itself.** Specifically, none of these may pause or stop a
running timer, or show *"Start the Virtual Tracker Agent…"*, *"Timer paused…"* or any
connection-error message:

- pressing **Refresh** on the **Screenshots**, **Tasks** or **Projects** page, or any other page
- **reloading** any dashboard page in the browser (F5, Ctrl+R), or restoring it after a crash
- opening the dashboard in **another tab**, or having several tabs open at once
- **switching pages**, or leaving a tab in the background and returning to it
- a **slow or failed request** from the dashboard (network blip, backend restarting, Redis
  restarting). A failed refresh keeps showing what it last had and retries quietly.

Only three things may pause or stop a timer from the dashboard side: the member clicking **Pause**
or **Stop**, a **policy** (task deleted, task limit, budget/daily cap), or the agent being
**genuinely absent for at least 60 seconds** (A4). Part F's tests (F1) enforce this rule page by
page.

---

## Already fixed — do not redo

| Fix | Commit | Released |
|---|---|---|
| Server reaped sessions of healthy agents: the session poll now marks the row as watched | `a78a3d3f` | Backend (live) |
| Heartbeat TTL 15s → 60s, and the agent's sync also writes the heartbeat | `eb33139a` | Backend (live) |
| Dashboard pauses only after 3 consecutive failed agent checks (was 1) | `eb33139a` | Web (live) |
| `restoreSession` no longer pauses on one reading | `eb33139a` | Web (live) |
| Idle detection no longer depends on Windows hooks that can be silently removed | `f7217f96` | Agent v1.0.2 |
| Sub-second truncation in credited time, working and on breaks | `f7217f96`, `f1999803` | Agent v1.0.2 / v1.0.3 |

---

## 1. Inventory: every path that can pause or stop a session

"Single sample" means the path acts on one reading without confirming it. "Recorded" means
something durable says why it happened. Line numbers are as of `eb33139a`; function names are the
stable reference.

### Server — `Dashboard-Backend`

| # | Path | Where | Trigger | Deliberate? | Recorded? | State |
|---|---|---|---|---|---|---|
| S1 | Abandoned-session reap | `agent-heartbeat.js` `closeAbandonedSession` | Session row untouched for 5 min | No: absence | Log line + security event | Fixed for healthy agents. Still fires on real outages over 5 min, and the agent resumes via `try_recover_lost_session` |
| S2 | `action=stop` | `activity/routes.js` POST `/api/activity/session` (~L775) | Any client | Varies | `stop_note` only (the member's own text) | **No actor, no reason** |
| S3 | `action=idle` | same route (~L723) | Any client | Varies | Nothing | **No actor, no reason** |
| S4 | Timer / budget cap on sync | same route (L797–830) | Daily cap or project budget reached | Yes: policy | Agent shows a status message | Correct. Unrecorded server-side |
| S5 | Boot-time duplicate close | `ensure-lookup-schema.js` (~L902) | Every server start | Housekeeping | Nothing | **Verified safe**: closes only *duplicate* open sessions and keeps each member's newest. A deploy does not stop live timers |

### Dashboard — `Dashboard-Web` (the dashboard interactions)

| # | Path | Where | Trigger | Single sample? | What the member sees | State |
|---|---|---|---|---|---|---|
| W1 | Periodic agent check | `activity-tracking-context.tsx` `enforceAgentReady` | Every 5s while a timer is active | No (3 in a row) | "…Timer paused until the agent reconnects." | Fixed, but the 15s window is shorter than a Redis restart (see R1) |
| W2 | Session restore on load | same file, `restoreSession` | Page load / timer bootstrap | No longer decides | — | Fixed |
| W3 | **`ActivitySessionGuard`** | `activity-session-guard.tsx` L26–39 | **Every dashboard load and every new tab** (mounted in `app/dashboard-shell.tsx`) | **Yes** | "…An active timer was paused because the agent is not linked." | **Open** — same bug as W2, missed |
| W4 | **Session poll re-pause** | `activity-tracking-context.tsx`, session poll (~L546) | Server says active, dashboard says idle | **Yes** | "…Timer stays paused until the agent is linked." | **Open** — undoes an agent resume: ping-pong |
| W5 | **Dashboard sign-out stops the timer** | `auth-context.tsx` `logout()` L1124 posts `stop` | Sign-out; **"Use a different account" on the agent-link page** (`agent-link-flow.tsx` L169); **account restriction** (`auth-context.tsx` L344) | n/a | Nothing: the agent just stops | **Open** — the dashboard ends a session the agent owns |
| W6 | Pause / Stop buttons | `toggleTimer`, `stopTracking` | Member clicks | n/a | — | Deliberate. But the agent then drops the whole session (A5) |
| W7 | Task deleted | `stopTracking` on `tasks` change event (~L403) | Someone deletes the task being tracked | n/a | "…was deleted — timer stopped, your time up to now was saved." | Correct |
| W8 | Task limit reached | `handleTaskLimitReached` (~L420) | Task's hour limit | n/a | Limit notice | Correct |
| W9 | Web idle watch | `startIdleWatch` (~L575), only when `!isAgentMode` | Tab idle / hidden in *web-capture* mode | n/a | — | **Verify.** `isAgentMode` comes from `captureMode` in the status response (`agent-status-context.tsx` L54). If the first status fetch fails, the mode is unknown, and the web idle watch could act on an agent-owned session |
| W10 | **In-page Refresh: Screenshots, Tasks, Projects** | `screenshots.tsx` L485 (feed + insights reload), `tasks-page.tsx` L459 (`refetchTaskLists`), `projects-page.tsx` L289 (`refetchProjects`) | Member presses Refresh | n/a | Nothing: failures only log to the console (`tasks-page.tsx` L476, `projects-page.tsx` L130) | **Verified safe by itself.** None touches the timer. `presencePingEvent` only *listens* (`use-cached-list.ts` L205), so a refresh cannot fake the "task deleted" event W7 stops on. The reported "Refresh stopped my timer" was W1 firing in the heartbeat gap at the same moment |
| W11 | **Browser reload of any dashboard page** | Remounts `app/dashboard-shell.tsx`, which runs W3 and a fresh agent-status fetch | F5 / Ctrl+R / crash restore / new tab | Yes, via W3 | W3's toast | **Open.** A reload is the real "refresh stopped my timer" path. Fixed by A1 + A3 |
| W12 | **Refresh-time request burst** | Any page refresh fires many requests at once; the agent-status check among them can be slow or fail | Refresh on a slow connection | Counts toward W1 | W1's toast | **Open.** A failed status check reads as "agent offline" (RC2), so a heavy refresh can feed a false pause. Fixed by A3: an unknown reading never counts |

### Agent — `Tauri-App-Extension`

| # | Path | Where | Trigger | Recorded? | State |
|---|---|---|---|---|---|
| A1 | Idle escalation (stop and rewind) | `tracker.rs` `tick_idle_escalation` | No real input past the project's allowance | Local log | Fixed in v1.0.2 (`GetLastInputInfo`) |
| A2 | Cap / budget stop | `tracker.rs` after sync | Server reports `timerCapped` / `budgetCapped` | Status line | Correct |
| A3 | Quit / sign-out / re-link | `controller.rs` `flush_and_stop_tracker(reason)` | Member action | **Reason written to the local log only**, never sent | Deliberate, untraceable server-side |
| A4 | Member Stop (with note) | `controller.rs` (~L1065) | Member action | `stop_note` | Correct |
| A5 | **Server says non-active → agent drops the session** | `tracker.rs` ~L675 | Any `status != "active"`, including a dashboard pause (legitimate or false) | Status line | **Open** — a false dashboard pause stops the agent's capture completely, not just the display |
| A6 | Session vanished → recover | `tracker.rs` `try_recover_lost_session` | Server closed it (S1) | Local log | Correct: resumes with local totals |

---

## 2. Root causes

These are what the open items above have in common. Fix a cause and every path that shares it is
fixed.

**RC1 — Decisions made on a single reading.** W3 and W4 pause on one "agent offline" answer, and
W1 and W2 did until yesterday. One reading is not evidence: a heartbeat gap, a slow request or a
backend restart all produce it.

**RC2 — "Couldn't check" is treated as "agent is offline". Twice.**
- *In the dashboard:* `fetchAgentStatus` (`activity-api.ts` L135–145) returns `null` on **any**
  failure: non-OK response, network error, backend restarting. `null` becomes
  `agentOnline !== true`, which becomes "not running" (`agent-status-context.tsx` L60–86). So a
  dashboard network blip pauses the timer.
- *On the server:* `isAgentOnline` returns `false` when Redis is unreachable. That is the same
  mistake TC-1 fixed for the abandoned-session sweep, still present on the dashboard's path. A
  Redis outage makes every agent read as offline at once (see R1).

**RC3 — The dashboard acts on sessions the agent owns.** In agent mode the agent is the timer. The
dashboard still stops it on sign-out (W5) and pauses it on its own readings (W3, W4). The agent
then treats any pause as the end of the session (A5), so the damage compounds.

**RC4 — No stop records its cause.** `stop_note` is the member's own text. The audit trigger does
not cover `activity_sessions`. The agent's stop reasons go to a local log file. Nothing lets
anyone answer "what stopped this timer at 10:42?".

**RC5 — The toast states things the dashboard cannot know.** *"Start the Virtual Tracker Agent on
this PC"* asserts two facts: that the agent is not running, and that it would be on *this* PC. The
dashboard knows neither. It knows only that one status check did not return `agentOnline: true`.

---

## 3. The plan

### Part A — Prevention: dashboard interactions

**A1. `ActivitySessionGuard` stops deciding.** Remove its pause (W3). If the server session is
active, set the phase to active and let `enforceAgentReady` decide, exactly as `restoreSession`
now does. A page load or a new tab must never pause a timer by itself.

**A2. The session poll stops re-pausing.** When the server says active and the dashboard says
idle (W4), follow the server. If the agent really is missing, the enforcer will pause it on a
sustained absence. This ends the ping-pong with agent resumes.

**A3. Three-state readiness: online, offline, unknown.**
- *Web:* `fetchAgentStatus` returns `{ state: "unknown" }` on any failure instead of `null`. An
  unknown reading never counts toward the pause streak and never shows the agent toast.
- *Server:* `/api/activity/agent/status` returns `agentOnline: null` when Redis cannot answer,
  instead of `false`.

**A4. Absence is measured in time, not checks.** Replace "3 checks in a row" with "the agent has
not been seen for at least 60 seconds". The server already knows when it last heard from the
agent, so it should report `agentLastSeenAt`, and the dashboard should compare against that. The
agent writes every ~15–20s, with a worst case around 35s (poll every 3 ticks, one skipped tick, a
request at the 15s timeout). 60s sits safely beyond that. It also survives a Redis restart, which
the current 15s window does not (R1).

**A5. Signing out of the dashboard does not stop an agent-owned session.** In agent mode, or when
the open session's `source` is `agent`, `logout()` signs the tab out and leaves the session alone.
This covers plain sign-out and **"Use a different account" on the agent-link page**. Account
restriction is a policy call (see §5, D-1). If it still stops the timer, it must record
`account_restricted`.

**A6. Know the mode before acting.** Until `captureMode` is known, do not run the web idle watch
against an existing session whose `source` is `agent` (W9). Derive agent mode from the session as
well as from the status response.

**A8. Page refreshes and reloads are read-only for the timer.** Written as a contract, not left
implied. The refresh handlers (W10) must never call the timer or session API, and a reload (W11)
must never pause on its own, which A1 guarantees. A failed refresh keeps showing the last data it
had and retries quietly: no toast, no pause, no "connection" message. Add a comment at each
refresh handler pointing here, so a future "refresh also re-syncs the timer" change is caught in
review.

**A7. One decision point.** After A1–A6, "pause because the agent is missing" lives only in
`enforceAgentReady`. Every other path reads state and never writes it. A code comment at each
former site says so, so the next change does not reintroduce a second decider.

### Part B — The toast tells the truth

**B1. Word it by what is actually known.**

| Situation | Message |
|---|---|
| Status check failed (unknown) | No agent toast. At most a quiet "Can't reach the server — retrying." |
| Agent not seen for ≥ 60s, timer running | "The Virtual Tracker Agent hasn't checked in for a minute. Your timer is paused until it reconnects." |
| Member clicks Start or Resume and the agent is not seen | "The Virtual Tracker Agent isn't running for your account. Open it and sign in, then try again." |
| Agent never linked | Keep the existing link instructions |

Drop "on this PC" everywhere. The dashboard cannot know which machine the agent is on.

**B2. Only say "paused" when a pause happened.** The same message family is used for pre-flight
refusals (start or resume blocked) and for actual pauses. Separate the two, so "Timer paused" is
shown only when a running timer was actually paused.

**B3. Don't repeat, and don't lose it.** Suppress an identical notice within a few minutes. The
notice lives in `TimerButtonIdle` and `TimerButtonLive` separately (`timer-button.tsx` L64–71 and
L168–181). Only one renders at a time, so there are no duplicates, but a notice set in one is lost
when the button swaps to the other. Lift the notice into shared state.

**B4. Offer the way back.** When the agent reappears after an auto-pause, the notice changes to
"The agent is back — Resume", with the action on the toast (see C2).

### Part C — Recovery

**C1. The agent survives a dashboard pause (A5 of the inventory).** On `status == "idle"`, keep
the task, baseline and elapsed state and stop capturing. Do not `reset_task_progress`. When the
server goes back to active, carry on from the same totals. Reset only on `stopped` or on a
different session id. Needs an agent release.

**C2. Auto-pauses undo themselves.** If the dashboard paused a timer for `agent_absent` (recorded,
see D1) and the agent reports back within a window (proposed: 10 minutes), resume automatically
and tell the member. A deliberate pause is never auto-resumed. The window is a policy call (§5).

**C3. Keep `try_recover_lost_session` as the backstop** for outages longer than the reap
threshold. Its carried-forward totals get the reason `recovered_after_reap` (D1), so recovered time
is visibly marked in reports.

### Part D — Traceability: every stop records its cause

**D1. `stop_reason` and `stopped_by` on `activity_sessions`**, and `pause_reason` for idle
transitions. The value set:

`member_stop` · `member_pause` · `dashboard_signout` · `agent_quit` · `agent_signout` ·
`agent_relink` · `idle_escalation` · `timer_cap` · `budget_cap` · `agent_absent` ·
`abandoned_reap` · `recovered_after_reap` · `task_deleted` · `task_limit` ·
`account_restricted` · `duplicate_close`

Auto-applied by `ensure-lookup-schema.js` like every other column.

**D2. The session route requires a reason.** POST `/api/activity/session` takes a validated
`reason`. `stopped_by` is the authenticated member. `source` is `agent` or `web`, from the request
origin. Missing or unknown reasons are stored as `unspecified`, never rejected, so an old agent
still works. The count of `unspecified` shows how much of the fleet has not updated.

**D3. An append-only `activity_session_events` table** holding: session id, time, action, reason,
actor, source, and client version. One row per start, pause, resume, stop and recover. This turns
"it stopped on its own" into a timeline.

**D4. Agent version on every request.** An `X-Agent-Version` header, stored on D3 rows. It ties a
report to a build without asking the member.

**D5. Show it.** The Work Sessions report gains a "Stopped by" column (e.g. "Dashboard sign-out",
"Agent absent 1m 20s", "Idle 5m"). Admins get a per-member timeline view from D3.

### Part E — Monitoring

**E1. Count stops by reason.** `recordSecurityEvent` already exists. Emit one event per
auto-reason (`agent_absent`, `abandoned_reap`, `idle_escalation`).

**E2. Measure false pauses directly.** An `agent_absent` pause followed by an agent check-in within
2 minutes is almost certainly false. Report that daily. The target is zero, and a non-zero count is
the early warning for the next regression of this kind.

**E3. Watch the heartbeat gap.** Log whenever the gap between an agent's writes exceeds half the
TTL. That is how a cadence change like LAG-1's gets caught before users feel it.

### Part F — Regression guards

**F1. Give `Dashboard-Web` a test runner.** It has none today, which is why W3 and W4 were never
caught. Add vitest, then test: three-state readiness, the absence window, that the guard and the
poll never pause, that sign-out in agent mode never stops, and toast wording per state.

Plus one test per page for the dashboard-interaction rule, each with a timer running:
- press Refresh on **Screenshots**, **Tasks** and **Projects** → no session request other than
  reads, no pause, no toast
- **reload** each page (remount the shell) → no pause, no toast
- make the agent-status request **fail** during a refresh → no pause, no toast, the agent still
  reads as "unknown", not "offline"

**F2. Backend:** reason validation and persistence, the reap recording `abandoned_reap`, and
`agentOnline: null` when Redis fails.

**F3. Agent:** `status == "idle"` keeps the session and totals (C1).

**F4. Make the cadence contract fail loudly.** `test/agent-heartbeat-ttl.test.js` currently copies
the agent's constants by hand. Read them from the Rust source instead, so changing
`SESSION_FETCH_EVERY_N_TICKS` without revisiting the TTL fails the backend suite.

### Part G — Runbook: "my timer stopped by itself"

Until D1–D5 exist, work from the inventory above. Once they do:

1. Get the member, the approximate time, and what they were doing (dashboard open? which page?).
2. Read their `activity_session_events` around that time. The `reason` column answers it.
3. Act on the reason:

| Reason | Meaning | Action |
|---|---|---|
| `agent_absent` | Dashboard paused: agent not seen for 60s+ | Check E2. If the agent was really running, it's a false pause: bug |
| `abandoned_reap` | Agent silent for 5+ min | Their network or machine. Confirm `recovered_after_reap` followed |
| `idle_escalation` | No input past the allowance | Expected. If they were working, check the agent version is ≥ 1.0.2 |
| `dashboard_signout` | Tab signed out | Should not exist after A5: bug |
| `unspecified` | Old client | Ask them to update the agent |
| `timer_cap` / `budget_cap` | Policy | Expected |
| `agent_absent` right after a page refresh or reload | The refresh coincided with, or caused, a failed status check | Should not exist after A1 + A3: bug. Note which page, and whether it was a Refresh button or a browser reload |

4. **Deploys and infrastructure:** a backend restart does not stop timers (S5, verified). **A Redis
   restart currently can pause every active timer on the dashboard (R1)** until A3 and A4 ship.
   Avoid restarting Redis during working hours until then.

---

## 4. Order of work

Ordered by harm still live today:

| # | Items | Why first | Ships via |
|---|---|---|---|
| 1 | **A3, A4** (three-state readiness, 60s absence, `agentOnline: null`) | Closes R1: a Redis restart pausing every timer at once | Backend + Web |
| 2 | **A1, A2, A7** (guard and poll stop deciding) | The single-sample pauses still firing on every page load | Web |
| 3 | **A5, A6** (sign-out and mode) | The dashboard ending agent-owned sessions | Web |
| 4 | **B1–B4** (truthful toast) | Members are being told something false | Web |
| 5 | **D1–D4** (provenance) | Makes every future report answerable. Worth doing before the next incident, not after | Backend + Web + Agent |
| 6 | **C1** (agent survives a pause) | Needs an agent release, so batch it with D4 | Agent |
| 7 | **C2, C3** (auto-resume) | Depends on D1's reasons | Backend + Web |
| 8 | **E1–E3, F1–F4, D5** | Monitoring, guards, reporting | All |

Items 1–4 need no agent release and reach every install as soon as they deploy.

---

## 5. Decisions needed from you

| # | Question | Recommendation |
|---|---|---|
| D-1 | Should an account restriction stop that member's running timer? | Yes, recorded as `account_restricted`. A restricted account should not keep accruing time |
| D-2 | After an auto-pause, resume automatically when the agent returns, or ask the member? | Automatically within 10 minutes, then notify. Beyond that, ask |
| D-3 | How long must the agent be absent before the dashboard pauses? | 60 seconds |
| D-4 | Signing out of the dashboard while the agent is tracking: keep the timer running? | Yes. The agent owns it |

## 6. Known risks today

**R1 — A Redis restart or outage can pause every active timer at once.** `isAgentOnline` answers
`false` without Redis (RC2). Every agent reappears only on its next write, 15–35s later. The
dashboard's pause window is three 5-second checks, about 15s. So after a Redis restart, a
dashboard tab with a running timer can pause it before its agent checks back in. **Fixed by A3 +
A4. Until then, avoid restarting Redis during working hours.**

**R2 — Every dashboard load still runs a single-sample pause (W3).** The more tabs and reloads,
the more false pauses. Fixed by A1.

**R3 — No stop is traceable.** Until D1–D3, each report means reading this document and guessing
which path fired.
