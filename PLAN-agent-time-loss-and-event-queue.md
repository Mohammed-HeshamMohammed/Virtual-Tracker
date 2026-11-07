# Plan: Tauri agent - time lost on restart/shutdown, and the screenshot/event queue

> **Status (2026-11-03): proposed; only tests written, no fixes.** Written from a read of the code
> (no run against a server, no log from an affected PC). Items marked UNVERIFIED need a
> reproduction or an `agent.log` before they are treated as confirmed.
>
> Related: `PLAN-tauri-pause-vs-break-and-restart-time.md` (shipped the power-event window;
> section 5.3 of it promised a queued stop that was never built - issue T1 below).

## 1. How it works today (so the issues make sense)

**Time.** `agent/tracker/tick.rs` + `progress.rs`: every 5 s the tracker credits the awake
time since the last tick (sleep excluded, `awake_clock.rs`; max 5 min per tick) to *idle*
when no input for longer than the project's idle allowance, otherwise to *active*. Totals are
`baseline + elapsed`. Every 20 s (`SESSION_SYNC_INTERVAL_SEC`) it POSTs `sync` to
`/api/activity/session` with the **running totals** (not deltas). The server
(`modules/activity/routes.js:621`, `updatePgSession`) subtracts the session's seed, only ever
raises totals (except `stop`), and credits the delta to the day the session *started*. Totals
are mirrored to disk each tick (`progress_store.rs`).

**Screenshots / events.** First screenshot 5 s after a session starts, then every 90-210 s
(random); none while idle, paused, on a break or in an excluded app. `capture/events.rs`
builds the event (JPEG q72, 1280 px wide), `client/api/events.rs` POSTs
`/api/activity/events`. On failure the batch goes to the JSONL queue (`queue.rs`, max 2000
batches) and is flushed every 30 s. The server (`routes.js:1120`) checks ownership,
capability and exclusion rules, drops images over 2.3 M chars, converts to WebP, hashes and
stores.

**Shutdown.** `power_events.rs` hears suspend / end-session and calls
`controller.stop_for_power` -> `flush_and_stop_tracker`, which POSTs `stop` with the real
totals. After a crash/power cut the server's sweep closes the session after 5 min
(`agent-heartbeat.js`); an agent that restarts first closes a session older than 90 s itself
(`STALE_SESSION_SEC`).

## 2. Issues

### Time lost on restart / shutdown

| ID | Issue | Evidence | Effect |
|----|-------|----------|--------|
| T1 | The power-time `stop` is sent once and its result is discarded; nothing queues it | `agent/controller/mod.rs:163` (`let _ =`), plan 5.3 promised a queued stop | Network down / API lock busy at shutdown -> no stop; session stays open on the server until the 5-min reap or the next start |
| T2 | The stop runs on Windows' message thread, which has only a few seconds, and needs `self.api.lock()` that the tick can hold for up to 30 s (event upload) | `power_events.rs` doc comment; `agent/tracker/upload.rs` holds the lock for the whole POST | Stop likely never sent when a screenshot upload is in flight at shutdown (UNVERIFIED on a real shutdown) |
| T3 | Stale-session close uses the **server's** totals, ignoring the on-disk mirror | `tick.rs:271-296` closes with `session["activeSeconds"]`; the mirror is only read in `rebaseline_for_task` | Up to ~20 s of tracked time lost per unclean exit |
| T4 | Reaped session gets `endedAt = sweep time`, not the last update | `agent-heartbeat.js:194` | Session end up to ~5.5 min too late; seconds are right, durations/reports built from start-end are off |
| T5 | After a reboot the timer does not restart by itself | Deliberate (`tick.rs` comments, plan section "restart stops everything") | Time between boot and the member pressing start is never tracked. Decision, not a bug - see OQ1 |

### The count stops after a restart (R1)

| ID | Issue | Evidence | Effect |
|----|-------|----------|--------|
| R1 | Any restart of the agent or PC ends the session; nothing resumes it. An agent that comes back more than 90 s later **closes** the server's open session itself (`stale_session_closed`) instead of continuing it | `tick.rs:271-297`, `STALE_SESSION_SEC = 90`; `handle_server_idle` closes a leftover pause the same way (`agent_quit`) | The member sees the count stop and must notice and press start. Everything between boot and that press is untracked. This is T5 promoted from "design decision" to a reported problem. Decided: keep stopping, add a restart notice (Phase 1b) |

### The tracker stops by itself, no visible reason (U1-U6)

Every stop the app issues carries a `reason` that the server stores in
`activity_session_events`, so each case below is checkable (see Phase 0). Candidate causes
found in the code, none reproduced yet:

| ID | Candidate | Evidence | Why it looks like "no reason" |
|----|-----------|----------|-------------------------------|
| U1 | Idle stop when input is not seen: the project's idle allowance (default 60 s) is measured from the global input hooks; if the hooks miss input (hooks died, an elevated window has focus, remote desktop, touch/pen) the app stops the timer and rewinds | `tick_idle_escalation`, `ActivityMeter::HOOKS_SUPPORTED`, `restart_hooks_if_dead`; hooks missing input for elevated windows is UNVERIFIED | Member was working but "idle" per the hooks; the stop message disappears from the UI quickly |
| U2 | Server reaps the session after 5 min without a poll or sync. The tick can stall that long: `flush` loops all queued batches under the API lock (Q4), and the pending-stop path returns early every tick | `agent-heartbeat.js` `SESSION_STALE_MS`, `queue.rs:61`, `tick.rs:196` | Agent is running but silent -> server closes `abandoned_reap`. The agent only recovers if online and `expect_stop` is false (`try_recover_lost_session`) |
| U3 | Sleep, lid close or modern standby sends `PBT_APMSUSPEND`, which is treated as a full stop, not a pause | `power_events.rs:35`, `stop_for_power` | A short lid close or display sleep ends the session; on wake the timer is just stopped |
| U4 | Server-side stops: daily task limit (`timer_cap`), project budget (`budget_cap`), paused session carried to another day (`closeIfPausedAcrossDays`) | `tick.rs:399-424`, `routes.js:977` | Correct by policy, but only a short status line explains it |
| U5 | The delivery of an idle stop that failed is retried with a **hard-coded** reason `idle_escalation`, and while it is pending the tick does nothing else (no poll, no sync, no capture) | `tracker/mod.rs:372-396`, `tick.rs:196-199` | A stop for another cause is recorded as idle; syncing halts until it lands (feeds U2) |
| U6 | Two sessions: a second device or the dashboard starting/stopping; the server refuses web actions on an agent session but a stale open session on another device blocks start (`409 already running on another device`) | `routes.js:705`, `isOneOpenSessionConflict` | Member's own start fails or the old session is closed under them |

### The app stops after midnight again (D1-D5)

`PLAN-timezone-and-day-boundary.md` is marked fully shipped, so this is a **regression or a
case the earlier work did not cover**. Reading the code, I found **no path that stops an
*active* session at midnight**; the only midnight-specific stop is `day_rollover`, and it
applies to *paused* sessions only (`day-rollover.js`, called on `resume`). The day logic was
reworked on 2026-10-22 (`e9084f2a`, `8420669d`: "one day rule for tracked time - the
session's project calendar", plus `day-rollover.js`), which is the first place to look.
Candidates, none reproduced:

| ID | Candidate | Evidence | Why it stops at midnight |
|----|-----------|----------|--------------------------|
| D1 | A pause/break that crosses midnight is closed and replaced on resume; the agent has to swallow a new session id with seeded totals | `day-rollover.js`, `routes.js:977`, `tick.rs:299` (session change branch) | The member sees the timer stop when they come back from a pause that spanned midnight; if the replacement is refused (D3) it stays stopped |
| D2 | Caps are **read** on the current day but time is **written** to the session's start day (sticky attribution) | `timer-limit.service.js:270-283` reads `todayDay`; `updatePgSession` -> `recordDailyActiveSecondsDelta` writes the start day. `enforceTimerAllowanceOnSync` compares the running session total to a ceiling built from today's bucket | After midnight the "today" bucket is empty while the session keeps writing to yesterday's; a task/member daily cap can trip (`timer_cap`) or never trip, depending on the numbers. Needs a test across midnight |
| D3 | Recovery after a reap or restart re-opens with `start`, which the server gates by working day, daily allowance and budget | `tick.rs:699` (`recovered_after_reap`), `routes.js:801-899` | Midnight into a day off ("block tracking on days off"), or into a new day whose allowance check fails, gives a 403 -> the agent cannot re-open and stays stopped |
| D4 | The day is decided from the timezone the agent reports (`timeZone` = the PC's zone) for the member, but from the **project's** zone for the session; if they differ, "midnight" is two different moments | `session.rs:94`, `adoptReportedTimezone`, `resolveProjectTimeZone` | The server and the app disagree on when the day changed; a gate or rollover fires at the wrong hour (the earlier fix "app follows the project" covers the UI, not necessarily every server check) |
| D5 | The 5-min reap and the stalled tick (U2) are more likely at night/idle machines | see U2 | Looks like a midnight stop when it is really a silent agent |

**Not guessing further:** which of these is real needs (a) the stop `reason` recorded on the
server for a member's midnight stop (`activity_session_events`: `day_rollover`, `timer_cap`,
`abandoned_reap`, `idle_escalation`...), and (b) one reproduction: run a session across
midnight in the project's zone with the existing PGlite test setup
(`day-attribution.pglite.test.js`) for each of D1-D4.

### Time lost after one of those stops (L1-L3)

| ID | Issue | Evidence | Effect |
|----|-------|----------|--------|
| L1 | After any stop, nothing counts until the member starts again; the gap from the stop to that moment is never recorded | Every stop path calls `end_session`/`reset_task_progress`; no auto-resume | Largest loss for an unnoticed stop (U1-U3): minutes to hours |
| L2 | An idle stop rewinds active time to the last input the hooks saw and books the rest as idle; if the hooks missed real input (U1) real work is turned into idle | `rewind_active`; the server only bounds the rewind by the allowance (`guardIdleRewind`) | Time worked after the last *seen* input is lost up to the allowance |
| L3 | T1-T3 above: an undelivered stop, a stop that raced the reap, and stale-close using server totals | see above | Up to ~20 s per event, more if the stop is missing and the server reaps first |

### Screenshot / event queue

| ID | Issue | Evidence | Effect |
|----|-------|----------|--------|
| Q2 | `inserted: 0` is treated as a failed upload, so the batch is re-queued | `client/api/events.rs:56`; server returns 0 for excluded apps, oversize images, policy drops | Batch retried every 30 s until pushed out by the 2000 cap; wastes bandwidth and disk |
| Q3 | Events carry no capture time; the server stamps "now" | `types/capture.rs` has no timestamp; `routes.js:1226,1286` fall back to `now` | Queued screenshots / app slices are recorded at flush time, not capture time |
| Q4 | `flush` keeps trying every batch after the first failure, holding the API lock | `queue.rs:61-89` | Offline / hanging network: tick can stall (up to 2000 x 30 s); UI calls wait on the lock |
| Q5 | Queue can reach hundreds of MB (base64 JPEGs, 2000 batches) | `queue.rs:10` | Disk growth on long outages (UNVERIFIED size) |

## 3. Fixes

### Phase 0 - find out why it stops (U1-U6, no code change)
1. Query `activity_session_events` for affected members: group stops by `reason`, `source`,
   `client_version`. `idle_escalation`, `abandoned_reap`, `system_suspend`,
   `stale_session_closed`, `agent_quit` each map to one candidate above.
2. Ask for `agent.log` from an affected PC around a stop (the app logs every stop path).
3. Add a log line and a persisted "last stop: reason, time" shown in the app, so the member
   (and support) can see why the count stopped instead of a status that disappears.

### Phase 0b - midnight (D1-D5)
1. Pull the stop reasons for sessions that ended within an hour of the project's midnight
   (server query on `activity_session_events` joined to the session's project zone).
2. Write failing tests first: an active session running through project-midnight, a pause
   across midnight then resume, and a recovery `start` just after midnight into a day off /
   a fresh daily allowance, each with the project zone different from the PC zone.
3. Fix what the tests show. Rule to keep: an **active** session is never stopped by the day
   changing; only a policy the member can see (day-off block, cap) may stop it, with the
   reason shown (Phase 0 item 3), and a resume/recover across midnight must not be refused
   by a gate meant for a fresh start.

### Phase 1b - stops that should not happen, and ones that must be explained (R1, U2, U3, U5, L1)
1. **Decided (OQ1): stay stopped, but tell the member.** No auto-resume. When the agent
   starts and the last run ended with a running timer (shutdown, crash, update, power cut),
   show a notification and an in-app banner: "Your timer stopped at HH:MM when the app/PC
   restarted - start it again?" with a one-click Start on the same task/project. The stop
   time and reason come from the persisted "last stop" record (Phase 0, item 3) so it is
   shown even after a crash. Time between the stop and the member's click stays untracked.
2. Sleep/lid close: pause (keep the session) for short suspends; stop only when the suspend
   outlasts the grace window.
3. Never let the tick go silent: sync/poll keep running while a stop is pending; deliver the
   pending stop with its **own** reason; flush runs with a batch cap (Q4 fix).
4. Idle stop: when the hooks report no input at all for the whole stretch but the OS
   reports recent input (`GetLastInputInfo`), trust the OS; log when the two disagree.

### Phase 1 - never lose a stop (T1, T2, T3)
1. Persist an undelivered stop to disk (reuse `PendingStop`; new small file next to
   `progress_store`). Written *before* the POST, removed on success.
2. On startup, before any session fetch, deliver a persisted stop for the same member. If
   the session is already closed server-side, drop it.
3. In `flush_and_stop_tracker`, use `try_lock_for` with a short wait and fall back to the
   persisted stop instead of blocking the power thread. Give uploads a shorter timeout when a
   power event is pending.
4. In the stale-close path (`tick.rs:271`), use `max(server, mirror)` when the mirror's
   session id and task match - same rule `rebaseline_for_task` already applies.

### Phase 2 - queue correctness (Q2, Q3, Q4)
1. Treat `inserted: 0` as *delivered* (log it); keep `desktop_agent_ingest_disabled` as the
   only non-delivery case.
2. Add `capturedAt` (ISO, set when the event is built) to every `ActivityEvent`; the server
   already reads `captured_at` for screenshots - accept `capturedAt` as well and use it for
   app/url rows, clamped to `[session start, now]` so a bad clock cannot back-date.
3. `flush`: stop at the first failure and leave the rest; per-flush batch cap (e.g. 20);
   do not hold the API lock across the whole loop.

### Phase 3 - server and hygiene (T4, Q5)
1. `closeAbandonedSession`: set `endedAt` to the session's `updated_at`.
2. Cap queue by bytes as well as batch count (drop oldest screenshots first, keep app/url).

## 4. Tests
- Rust: pending stop is written before the POST, survives a restart, is delivered once;
  stale close keeps the larger of server/mirror; `inserted: 0` is not re-queued; flush stops
  at first failure; `capturedAt` round-trips through the queue.
- Backend (`npm test`): reaped session `endedAt` equals last `updated_at`; `capturedAt`
  accepted, clamped, and ignored when out of range.
- Rust: after an unclean exit the next start surfaces the "timer stopped at HH:MM" notice
  once, with the right time and reason, and does not start counting; lid-close shorter than the
  grace pauses and resumes; a pending stop keeps its own reason and does not block sync;
  OS-vs-hook input disagreement is logged and not treated as idle.
- Manual matrix: sleep 10 min and wake; restart Windows with the network unplugged; hard
  power-off during a screenshot upload; offline 10 min then reconnect (check capture times).

## 5. Rollout
Agent and backend ship separately: the backend change (accept `capturedAt`, `endedAt` fix)
must be deployed **before** the agent that sends `capturedAt`; old agents keep working.
No release is cut until this plan and the open vulnerability work are closed.

## 6. Open questions
- **OQ1 - answered 2026-11-03:** a restart stays stopped, and the member is notified (see
  Phase 1b item 1). Auto-resume was rejected: it risks counting time nobody started.
- **OQ2.** What is "lost" exactly: ~20 s, minutes, or whole sessions? Which reboot kinds
  (Windows Update, hard power-off, both)? An `agent.log` from an affected PC would settle
  T1/T2 vs. T5.

## 7. Test audit - Tauri Virtual Tracker app (2026-11-03)

Judged from reading the tests, not from mutating the code under them. Overall the Rust
tracker tests are good: they drive the real `tick()` against a fake HTTP server and assert on
what was POSTed. The weak spots are small, and the real problem is what is **not** tested.

**Low-value tests (candidates to delete or fold into a better one)**
- `tracker/tests.rs`: `a_positive_idle_threshold_is_valid`, `a_zero_idle_threshold_is_rejected`,
  `zero_elapsed_credits_zero`, `zero_clock_stays_zero` - one-line asserts on trivial arithmetic;
  the neighbouring boundary tests (`the_clamp_boundary_is_exact`, the rewind tests) already
  cover the same code with real cases.
- `power_events.rs` tests only check the message-to-reason table (`reason_for`). They say
  nothing about the shutdown actually closing the session; that path has one happy-path test
  (`use_cases.rs:274`) and none for a failed or slow stop (T1, T2).
- `src/**/*.smoke.test.tsx` (`tiles`, `sidebar`, `EasyView`, `LogTimeModal`, ...): they render
  to a string and assert `toContain("38h left")`-style copy. They break on a wording change
  and do not check behaviour (what happens when a button is pressed). Keep the ones that
  press something (`SessionControls`, `HelpButton`, `TourLayer`); trim the rest to the few
  that guard a real bug (e.g. "renders nothing when there is no budget").
- `components/everyButtonHasATip.test.ts`: a hand-written JSX tag parser run as a test. It is a
  lint rule in disguise and fragile; an ESLint rule (or `eslint-plugin-jsx-a11y` config) does
  the same job without 40 lines of parser to maintain.
- `utils/theme.test.ts`: mostly `classList.contains` toggles for a 3-value setting; low risk,
  low value. Fine to keep, not worth extending.

**Missing tests (the ones that matter for this plan)**
- A failed or slow stop at shutdown/suspend (T1, T2) - nothing exercises `stop_for_power`
  with an unreachable server or a busy API lock.
- Stale-session close with the on-disk mirror (T3) - now written, see below.
- Upload outcomes (Q2) and a failing flush (Q4) - now written, see below.
- Restart notice after an unclean exit (R1) - needs the Phase 0 "last stop" record first.
- A contract test between agent and backend: the agent's event JSON against the server's
  reader (`capturedAt`, `imageData`, `inserted`) - today each side is tested against its own
  mock of the other.

**Written in this pass (all in the repo, suite green)**

| Test | File | Status |
|------|------|--------|
| `a_failed_send_stops_the_flush_and_keeps_every_batch` (Q4) | `src-tauri/src/queue.rs` | `#[ignore]`, **fails today** - proves the bug |
| `events_the_server_dropped_on_purpose_are_not_retried_forever` (Q2) | `src-tauri/src/client/api/events.rs` | `#[ignore]`, **fails today** |
| `a_stale_session_is_closed_with_the_larger_of_the_server_and_the_disk_mirror` (T3) | `src-tauri/src/agent/tracker/tests.rs` | `#[ignore]`, **fails today** |
| `a_disk_mirror_from_another_session_is_not_used_...` | same | passes - guards the fix from over-reaching |
| `events_the_server_stored_are_delivered`, `..._ingest_is_switched_off_stay_queued`, `a_server_error_keeps_the_events_queued` | `events.rs` | pass - pin the cases that must stay as they are |
| `an active session running through the project's midnight keeps running and keeps its start day` (D) | `Dashboard-Backend/test/day-attribution.pglite.test.js` | passes |

Run the three known-bug tests with `cargo test --lib -- --ignored`; remove the `#[ignore]`
in the same change that fixes each bug.

**What the midnight test tells us:** the data layer (session row, daily buckets) does not stop
or split an active session at the project's midnight, even with the project and member in
different zones. So if the app really stops at midnight, the cause is above that layer: the
start/resume gates and daily-allowance checks in `routes.js` (D2, D3), or a silent agent (U2).
Those need route-level tests next; D2/D3 are the first to write.

## 8. Done so far (2026-11-03)

Fixed, tests un-ignored and passing (lib: 346 passed): **Q2** (`inserted: 0` is final, not re-queued),
**Q4** (flush stops at the first failure and keeps that batch and those behind it, in order),
**T3** (a stale session is closed with the larger of the server's and its own disk mirror's totals).
Two older queue tests that encoded "keep trying after a failure" were updated to the new rule.
Done later: U1/U4/U6 findings and change - U1's "trust the OS" is already in the code (`idle_seconds` is the smaller of the hook clock and `GetLastInputInfo`, and dead hooks are reinstalled), so the remaining U1 risk is only what neither source sees. U6's premise was partly wrong: a `start` while another session is open does not 409, it returns that session; the 409 is only the one-open-session race. What changed: every `Timer stopped...` status (idle, daily limit, budget) is now also a desktop notification, and a session closed under a running timer that this app did not ask to stop (another device, the dashboard, the server's own closes) now says "Timer stopped - it was ended elsewhere" instead of looking like a normal sign-in state. Still unknown: which of these is behind the member's real stops - that needs `agent.log` or the server's stop reasons (Phase 0 items 1-2). T4 (a reaped session ends at its last update, not the sweep time), Q3 (a queued batch carries `capturedAtMs`; the server uses it, clamped to the last 7 days, instead of its own clock), Q5 (queue file capped at 200 MB, oldest batches dropped and counted). R1 (launch notice when the last run left a timer open; no clock time shown, no one-click Start yet). Still open: T1, T2, U1-U6, D2/D3, Q3, Q5, T4, Phase 0.

## 9. What the app saves locally today (and does not)

| What | Saved to disk? | Used for |
|------|----------------|----------|
| Running totals (session id, task, active, idle) | Yes, every tick (`progress_store`, atomic write) | Re-baselining when it re-adopts the same session; now also the stale-session close (T3) |
| Events (screenshots, app/URL slices) | Only **after** an upload fails (`queue.rs`); not written first | Retry when the connection returns. A crash mid-upload loses that one event |
| Pending idle stop | **No** - memory only (`pending_stop`) | Lost if the app dies before it is delivered |
| Stop at shutdown/suspend | **No** - one POST, result ignored (T1) | Nothing |
| Last stop time and reason | **No** | Planned (Phase 0 item 3) for the restart notice |
| Last known task/project | Partly (inside the progress file) | - |

So the fallback you describe exists for **time totals** but not for **stops** or for events
until they have already failed once. Direction (Phase 1): write the stop to disk *before*
sending it and delete it only on success; write each event to the queue first and remove it on
success (write-ahead), so a crash or a dead network at any moment loses nothing.

## 10. Save-before-send - built (2026-11-03)

- **Stops (T1, T2, U5):** `ActivityTracker::close_session` writes the stop to
  `pending-stop.json` first, sends it, and deletes the file only when the server accepts it.
  The shutdown/sleep/sign-out/quit path now uses it (and sends the project id for task-less
  sessions). It waits at most 3 s for the API client, so the shutdown handler cannot hang on a
  busy upload; the stop stays on disk. The idle stop is written the same way and now keeps its
  own reason when retried (was hard-coded `idle_escalation`).
- **Next start:** a stop found on disk is only sent if the server still shows *that same
  session* open; if the session is already closed it is dropped, if the member has since started
  another it is dropped without touching it, and if the server cannot be asked it is kept.
- **Events:** each batch is written to `pending-events.inflight` before the request and removed
  after it; a failed send is queued as before, and a leftover file from a crash is queued by the
  next start. Known trade-off: a crash after the server stored a batch but before the file was
  removed sends that batch twice (a duplicate screenshot rather than a lost one).
- **Tests added (354 lib tests pass):** stop stays on disk when refused and is gone once
  delivered; a left-behind stop is delivered for the same open session, never ends a newer one,
  waits when the server is unreachable; batch on disk while sending and gone after success;
  failed send queued once; crash leftover recovered; damaged leftover discarded.
- **Still open:** the restart notice (R1) and the "last stop" record (Phase 0 item 3), T4, Q3, Q5,
  U1-U4/U6, D2/D3. Not verified on a real shutdown or power cut; only the logic is tested.

## 10. U3 - sleep and lid close (done)

Sleep used to end the session (`system_suspend` stop), so even a short lid close left the timer stopped.
Now: on sleep the agent pauses the session (`idle`, reason `system_suspend`) and keeps its totals; on
waking (`PBT_APMRESUMESUSPEND` / `PBT_APMRESUMEAUTOMATIC`) it resumes the same session (`system_resume`),
retrying for a minute while the network comes back. A sleep longer than 15 minutes, a shutdown, a pause the
member made, or a pause the server cannot be told about still closes the session as before, and a long
sleep says so ("Timer stopped - the computer was asleep too long", also a desktop notice). The server
keeps a sleep-paused session for 20 minutes instead of 5 before reaping it, so the resume finds it open.
Time asleep is not counted (the awake clock). Not verified on a real laptop: only the logic is tested.
The 15-minute grace is my choice, not a measured one.

