# Plan: Tauri tracker - "Pause starts on its own", Pause vs Break, time growing across a restart

Status: PLAN ONLY. Nothing has been changed. Written 2026-10-07 from reading the
agent code (`Tauri-App-Extension/src-tauri/src/agent/**`, `src/components/sidebar/**`) and the
backend session code (`Dashboard-Backend/src/modules/activity/**`). Anything marked
**UNVERIFIED** is a hypothesis that needs a reproduction or a log before it is fixed.

## 1. What the code does today (verified by reading)

### Pause, private break and the server "idle" status

- There is ONE paused state: `ActivityTracker.paused` (`tracker/mod.rs`).
- **Pause button** (`SidebarActions.tsx` -> `pause_session` -> `tracker.pause()`): posts the
  session action `"idle"` with reason `member_pause`, sets `paused = true`, starts the break
  clock (`BreakState::begin`). The button's own tooltip calls it "Pause the timer for a break".
- **Private break** (`controller/api.rs` -> `set_private_break` + `pause_for_private_break()`):
  also calls `pause()`, then `mark_private()`. So a private break and a Pause land in the
  SAME state and the UI shows the SAME thing ("Resume tracking"). This was decided on
  2026-09-26 ("Pause + private break both stop the timer"), see memory `break-semantics`.
- While paused, `tick_paused` credits the whole wall-clock gap to idle, re-syncs, and ends the
  pause by itself when `BreakState::is_over` (project `break_time_seconds`, default 10 min,
  unless `disable_break_limit`) -> "Break ended - timer resumed".
- Separately, the polling path (`tick.rs` ~line 245) treats a server status of `"idle"` as
  "paused by the server": it sets `was_active = false`, shows "Timer idle - capture paused" and
  credits nothing. It does NOT set `paused`, so there is no Resume button for it and no break
  limit that brings it back. The only things that write status `"idle"` are the `idle` session
  action (`activity/routes.js:872`, `tasks/routes.js:569`) - i.e. the agent's own `pause()`
  AND the web dashboard's timer pause.
- Idle escalation (`tick_idle_escalation`) is a different mechanism: warn -> alert -> STOP
  (rewind), it never pauses.

### Time across a sleep or a restart

- `credited_seconds` caps one tick at `SESSION_POLL_SEC * 4` (20 s), so a sleep/hibernate gap
  is not banked in a single tick. That part is deliberate and documented in `progress.rs`.
- The agent never tells the server it is going away. On shutdown/restart there is no stop,
  no pause, and no power/session-end handling anywhere (`grep` for powerbroadcast / endsession
  / suspend finds nothing). The server session stays `active` while the PC is off.
- On the next start the agent fetches the still-open session and re-baselines from the
  server's figures (`rebaseline_for_task`). If the server already closed it as abandoned
  (`abandoned-session-sweep`, every 30 s, based on the heartbeat), the agent runs
  `try_recover_lost_session`, which "resumes" a NEW session carrying its LOCAL unsynced total
  forward.

## 2. Suspected causes (need confirming; superseded in part by the decisions in section 4)

### A. "Pause starts on its own"

1. **Private break / break limit looks like Pause (most likely, by design).** A private break
   from the capture-privacy controls pauses the timer and shows the same Resume screen as
   Pause. The user never pressed Pause, so it reads as "paused itself". Same for the
   automatic resume ("Break ended") flipping state without a click.
2. **Pause started from somewhere else.** The web dashboard (or a second device/another
   agent on the same member) can post the `idle` action. The agent then reads status
   `"idle"` and goes into the half-paused "Timer idle - capture paused" state (no `paused`
   flag, no Resume button, no limit) - **UNVERIFIED**, need to confirm a web pause really
   reaches the open agent session.
3. **Pause surviving a restart / sign-in** - the server still holds the session as `idle`
   from an earlier pause (`member_pause`), a fresh agent reads `"idle"`, and shows
   "Timer idle - capture paused" without the user ever pressing Pause in this run -
   **UNVERIFIED**.
4. Idle escalation messaging ("Timer idle - capture paused", "Timer stopped - idle too
   long") reuses the word "paused/idle" for different things, which makes 1-3 harder to tell
   apart for the user.

### B. Tracked time grows when the PC or laptop restarts

1. **Local total carried forward over a gap.** `try_recover_lost_session` carries the local
   `baseline + elapsed` into a new session. After an abnormal end or a restart the local
   figure can be ahead of what the server credited (the 5-minute sync cadence vs. the
   moment it died) - **UNVERIFIED**, check the sum the agent posts on recovery against the
   server's last sync.
2. **The 20 s cap is per tick, not per gap.** A resume after sleep credits up to 20 s as
   active (by design) and then relies on idle escalation to rewind. If the machine wakes and
   the user does not touch it, idle escalation uses `idle_seconds` from the input hooks; if
   the hooks restart (`restart_hooks_if_dead`) or report a fresh "last input" at boot, the
   rewind point can be wrong - **UNVERIFIED**.
3. **A server-side figure derived from wall-clock.** If any display or sum is computed as
   `now - started_at` (dashboard timer, `current day` totals, `workspace.service.js`
   "total active today") instead of from credited seconds, an `active` session left open
   across a shutdown grows by the whole off-time - **UNVERIFIED**, needs a read of the
   dashboard timer and the sweep's idle/active accounting.
4. **No clean end at shutdown.** Because nothing pauses or stops the session on
   shutdown/sleep, every one of 1-3 has an open `active` session to misbehave with.

## 3. Investigation steps (before any fix)

1. Reproduce A with logging, one case at a time, and record the agent log lines
   ("Timer paused - on a break", "Timer idle - capture paused", "Break ended",
   "member_pause") and the session's `reason` history:
   a. press Pause -> wait for break limit; b. start a private break; c. pause from the web
   dashboard while the agent runs; d. restart the agent while the server session is `idle`.
2. Reproduce B: start a task, note server `active_seconds` and the agent display, then
   (a) sleep the laptop for 10 min and wake; (b) restart Windows; (c) hard power-off.
   Compare agent total, server total and the dashboard total after each.
3. Read the dashboard/server timer code for any `now - started_at` arithmetic.
4. Check `try_recover_lost_session`'s carried total against the last successful `sync`.
5. Add temporary, clearly-prefixed logging for: who set paused, the status read from the
   server on each state change, and the baseline/elapsed values at recover/rebaseline.

## 4. Decisions (owner, 2026-10-07)

1. **Two buttons, each with its own reason.**
   - **Pause** = "I'm not working, but I'm still at my desk doing something else."
   - **Break** = "I'm away from all of that."
2. **Pause never ends by itself.** Only the member's Resume ends it. Only a Break has a
   time limit (the project's `break_time_seconds` / `disable_break_limit`).
3. **Sleep or shutdown stops the session altogether** (not a pause to resume later).
4. **The web dashboard must not affect the Tauri app.** A pause/idle written from the web
   (or any other device) must never pause or stop this agent's timer.
5. The "paused on its own" cases were described as random - so the fix cannot rest on one
   guessed cause; see 5.2 (remove every way the state can change except the member's own
   actions, and log the rest).

## 5. Proposed implementation

### 5.1 Pause vs Break

| | Pause | Break |
|---|---|---|
| Meaning | at my desk, not on this work | away |
| Timer | stops | stops |
| Time while stopped | credited as idle | credited as idle |
| Capture (screenshots/apps/URLs) | **assumed: keeps running** - being at the desk is not being private (see Q-A) | blocked (today's private break) |
| Ends | Resume only, never by itself | Resume, or by itself at the project's break time |
| Server `reason` | `member_pause` | `member_break` (new) |
| Status text | "Paused" | "On a break - ends in mm:ss" (or "On a break" when the project has no limit) |

- Two separate buttons in the sidebar (and the Focus-mode tracking card), each with its own
  tooltip (the `everyButtonHasATip` guard requires one). The paused screen says which one is
  active and offers Resume + Stop.
- Today's single `paused` flag becomes a small state: `Running | Paused | OnBreak`.
  `tick_paused` only applies the break limit and the capture block to `OnBreak`; `BreakState`
  (limit, private flag) belongs to `OnBreak` only.
- Today's private break (`pause_for_private_break`) becomes the Break action itself - one
  concept, not "pause + private". Its length is still clamped to the project limit.
- Backend: accept the new `member_break` reason (`session-reasons.js`, the timer-action
  allow-list) and show it in reports next to `member_pause`. **Backend deploys first**: older
  backends reject unknown reasons, and the agent update contract forbids the reverse order.

### 5.2 The agent owns its own timer state

- Stop treating a server status of `"idle"` as "paused" in the polling path
  (`tick.rs` ~245). The agent's own state is the truth; the server's `idle` is only a record
  of what this agent last told it. A mismatch is logged, and the agent re-asserts its own
  state instead of obeying the server.
- The web dashboard's pause/idle action must not be able to reach an agent-sourced session
  at all: server side, reject (or ignore) a web-originated `idle` on a session whose
  `source = 'agent'` (`tasks/routes.js:569`, `activity/routes.js:872`). The dashboard
  gets a clear message instead ("this timer runs in the desktop app").
- On launch with an open server session that was left `idle`: do not silently adopt it.
  Show it as Paused/On a break (per its `reason`) with Resume, or if the reason is a system
  stop, treat it as already stopped.
- Because the cause was reported as random: add (temporary, clearly prefixed) logging of every
  `paused` transition with its origin (button, break limit, server read, startup adopt,
  other), plus the server status read on each change. If it still happens after 5.2 and
  5.3, those lines name the cause.

### 5.3 Sleep, shutdown, restart

- Handle OS power/session events in the shell: suspend (`WM_POWERBROADCAST`), session end
  (`WM_QUERYENDSESSION` / `WM_ENDSESSION`) and `RunEvent::ExitRequested`. On each:
  flush a final `sync` with the true totals, then **stop** the session with reason
  `system_suspend` / `system_shutdown` (new reasons, same deploy-order rule as 5.1).
  Any rewind of unattended time uses the existing idle-escalation rewind helper so nothing
  after the last real input is kept.
- If the stop cannot be delivered (offline, power cut), queue it like the existing
  `pending_stop`, and on the next start deliver it before anything else.
- On start, a session found still open on the server whose last heartbeat is older than the
  abandoned threshold is closed by the existing sweep; the agent must NOT "recover" it into a
  new session carrying its local total in that case. `try_recover_lost_session` is limited
  to a genuine in-run server loss (the agent is alive and has been heartbeating), and its
  carried total is clamped to the server's last synced figure plus one sync interval.
- Wake-from-sleep for a session that was somehow still open: any gap larger than the 20 s cap
  is credited as IDLE, never active; the first real input decides what happens next.
- Server/dashboard: if section 3 step 3 finds `now - started_at` arithmetic anywhere, replace
  it with the credited seconds.

## 6. Tests

- Rust (`tracker/tests.rs`): Pause never ends by itself even past the break limit; Break ends
  at the limit and not before; Break with the switch on never ends; capture blocked in Break
  and not in Pause; a server `idle` does not pause the agent; a suspend/shutdown event stops
  the session with the right reason; a recovered total is clamped; a gap beyond the cap is
  credited as idle.
- Backend: `member_break`, `system_suspend`, `system_shutdown` accepted and reported; a web
  `idle` on an agent session is refused; the live-Postgres harness covers the new reasons.
- Web: reports show the new reasons. Tauri frontend: two distinct controls, distinct tips.
- Manual matrix (section 3) re-run after the fix: sleep 10 min, restart Windows, hard power
  off, pause from the web while the agent runs, leave a Pause for an hour.

## 7. Rollout

1. Backend (new reasons, web-idle refusal) -> auto-deploys.
2. Dashboard-Web (reason labels, the message above).
3. Agent: bump version and run the manual `release` workflow. Old agents keep working
   (they only send `member_pause`); they stay subject to the update contract's minimum
   self-update version.

## 8. Still open

- **Q-A.** During a Pause (at the desk), should screenshots/app/URL capture keep running?
  The plan assumes yes (otherwise Pause becomes a second, unlimited private break).
- **Q-B.** Should a Break be available when the project has no break limit, or only Pause?
  The plan assumes both, with "On a break" and no countdown.
- **Q-C.** After a shutdown/sleep stop, should the next start show the session as stopped and
  just offer "Start tracking" (assumed), or remember the task/project and pre-select them?

---

## 9. Status: implemented 2026-10-07 (answers to Q-A/Q-B/Q-C applied)

Owner's final answers: during a Pause **no screenshots, but apps and URLs are still
recorded**; a Break is available on projects with no limit; after a shutdown/sleep stop the
next start is just "Start tracking" (no pre-selection).

What was built (and where it differs from the sections above):

- **Pause and Break are two buttons** (sidebar, Easy view, Focus card). Pause = reason
  `member_pause`, never ends by itself, apps/URLs recorded, no screenshots. Break = reason
  `member_break`, blocks all capture, ends at the project's break time (or never when the
  project's switch is on) or on Resume. Going on a Break from a Pause upgrades it without a
  second server call. The status text says "Paused" or "On a break" accordingly.
  A countdown on the Break screen was NOT built.
- **The web dashboard already could not pause an agent session** (the server refuses it with
  `web_on_agent_session`); what remained was the agent *obeying* a server-side `idle`. It no
  longer does: mid-run it puts the server right (`resume`, reason `agent_returned`); on start
  it closes a pause an earlier run left behind.
- **Sleep and shutdown stop the session** (`system_suspend` / `system_shutdown`) via a hidden
  window in `power_events.rs`; it flushes the real totals and clears Pause/Break.
- **A restart can no longer carry on a timer the member never started.** A fresh agent that
  finds an open session the server has not heard about for over 90 s (`secondsSinceUpdate`,
  measured server-side) closes it (`stale_session_closed`) instead of adopting it. This is the
  most likely cause of "tracked time increases when the PC restarts": the shutdown never
  stopped the session, and the restarted agent adopted it and kept counting.
- Backend: new reasons accepted and labelled; `secondsSinceUpdate` added to the session
  payload. An older backend or agent degrades safely (unknown reasons read as `unspecified`,
  a missing `secondsSinceUpdate` means "adopt as before"), so deploy order is not critical.
- Tests: 286 Rust, 338 frontend, backend suite, all passing.
- NOT verified here: the power-event window against a real sleep/shutdown, and the screens in
  the running app - both need a manual pass on a Windows machine (see section 6 matrix).
