# Investigation: Idle-Time Detection & Time-Tracking Accumulation

## Summary

A member clocked in for 2 hours on a project with a 10-minute idle allowance, left mouse/keyboard idle for 6 minutes (under the allowance), the Tauri app's on-screen clock kept counting the full 2 hours, but only 50 minutes (exactly 3000 seconds) ended up saved/visible server-side, and that number never grew further.

Two headline findings, verified against current source:

1. **The idle allowance itself works correctly.** `tick_progress()` (`Tauri-App-Extension/src-tauri/src/agent/tracker.rs:931-971`) credits any tick under the project's configured allowance to `active_elapsed`, not idle, and `tick_idle_escalation()` (`tracker.rs:794-900`) is a no-op below that same allowance. A 6-minute idle stretch under a 10-minute allowance is active time by design, not a bug. Idle mechanics are not what plateaued this session.
2. **The real defect is server-side capping plus a client-side display that can't see it.** `task_member_progress.active_seconds` — the number that actually shows up as "task progress" — is written with `GREATEST(task_member_progress.active_seconds, EXCLUDED.active_seconds)` on every non-stop sync (`Dashboard-Backend/src/lib/postgres/task-member-progress.service.js:63-105`). Once one of several independent allowance ceilings caps the reported value once, that row can never be written higher again for the rest of the capping period, even though the raw session number keeps growing. Meanwhile the Tauri app's on-screen clock (`Tauri-App-Extension/src/App.tsx:707-716`) is a local `setInterval` that increments every second and is merged with the server value via `Math.max`, so it can only ever go up — it has no way to reflect a frozen/capped server value and will happily keep ticking for the full 2 hours regardless of backend reality.

A secondary, previously-suspected-but-now-confirmed finding from the deep idle-mechanics pass: **the three-stage idle escalation (warn/alert/stop) can skip stages, including the very allowance the user described.** See "Idle escalation stage-skipping" below — this project's own 10-minute allowance sits exactly on the alert-stage boundary.

---

## Pipeline at a glance

```
┌─────────────────────────────────────────────────────────────────────────────┐
│ AGENT (Tauri, Rust) — loop_run(), tracker.rs:311-322                         │
│   tick() every SESSION_POLL_SEC = 5s (constants.rs:18)                      │
└───────────────┬───────────────────────────────────────────────────────────┬─┘
                │                                                           │
                ▼                                                           │
  ActivityMeter::idle_seconds() ─ activity.rs:319-322                       │
  (ms since last real OS hook input; Windows-only real hooks)               │
                │                                                           │
                ▼                                                           │
  tick_progress() ─ tracker.rs:931-971                                      │
   idle_seconds() >= project's idle_threshold_sec (allowance)?              │
     no  → credit delta to active_elapsed  (this is the "allowance")        │
     yes → credit delta to idle_elapsed                                    │
                │                                                           │
                ▼                                                           │
  tick_idle_escalation() ─ tracker.rs:794-900                               │
   (skipped entirely if idle_time_disabled, or !HOOKS_SUPPORTED)            │
   idle_for < allowance      → stage 0, remember active_at_last_input       │
   idle_for >= idle_stop_sec → STOP: rewind active to active_at_last_input, │
                                POST "stop", return true (session over)     │
   idle_for >= idle_alert_sec→ stage 2 "alert" (only first crossing)        │
   idle_for >= idle_warn_sec → stage 1 "warn"  (only first crossing)        │
                │                                                           │
                ▼ (every SESSION_SYNC_INTERVAL_SEC = 20s, tracker.rs:697-746)│
  POST /api/activity/session {action:"sync", activeSeconds, idleSeconds}    │
                │                                                           ▼
┌───────────────▼─────────────────────────────────────────────────────────────┐
│ SERVER (Dashboard-Backend) — activity/routes.js POST handler                │
│                                                                              │
│  1. updatePgSession()  activity-events-postgres.service.js:520-597          │
│     → activity_sessions.active_seconds = MAX(stored, incoming)              │
│       (unless allowDecrease:true, only passed on "stop", routes.js:681-696) │
│     → records the DELTA into daily_member_active_seconds /                  │
│       daily_member_task_active_seconds (line 592, 599-625) — the GLOBAL,     │
│       cross-project daily/weekly pool. This happens for every session,      │
│       task-having or task-less, and is NEVER capped/plateaued.              │
│                                                                              │
│  2. IF a taskId is attached to this sync (routes.js:707-709 gate):          │
│     syncTaskTimeTracking() → task-time-tracking.js:141-241                  │
│       → enforceTimerAllowanceOnSync() → timer-limit.service.js:324-348      │
│         → computeTimerAllowance() → timer-limit.service.js:195-290          │
│           Math.min() across up to 6 independent remainder sources           │
│         → caps activeSeconds down to the ceiling if exceeded                │
│       → upsertTrackingRowPg() → task-member-progress.service.js:63-105      │
│         task_member_progress.active_seconds =                               │
│           GREATEST(stored, capped_incoming)   ◄── THE PLATEAU               │
│                                                                              │
│  3. checkProjectBudgetCap() → routes.js:116-127, invoked at routes.js:738-745│
│                                                                              │
│  4. Response: { timerCapped, budgetCapped, ...session }                     │
└───────────────┬──────────────────────────────────────────────────────────────┘
                │
                ▼
  Agent reads sync_result.timer_capped / budget_capped (tracker.rs:716-720)
   → if either true: POST "stop" immediately, reset local state, emit_status
                │
                ▼
  App.tsx merges server activeSeconds into liveActiveSeconds via Math.max,
  then a local setInterval adds +1/sec regardless of server truth
   (App.tsx:707-716, 712-716) → on-screen clock cannot reveal a frozen cap
```

---

## Idle-time mechanics (deep dive)

### 1. Where `idle_seconds()` actually comes from

`ActivityMeter` lives in `Tauri-App-Extension/src-tauri/src/capture/activity.rs`.

- **Windows**: `run_listeners()` (`activity.rs:189-245`) installs two real, system-wide, low-level OS hooks via `SetWindowsHookExW(WH_KEYBOARD_LL, ...)` and `SetWindowsHookExW(WH_MOUSE_LL, ...)` on a dedicated thread that pumps a Win32 message loop (`GetMessageW`/`DispatchMessageW`). The hook callbacks (`keyboard_hook_proc` at `activity.rs:476-502`, `mouse_hook_proc` at `activity.rs:504-541`) fire on every real keydown / mouse click / mouse move system-wide (not just inside the app), and each one calls `note_input()` (`activity.rs:270-275`), which stamps `last_input_ms` with the current wall-clock time. Each hook also reads the OS's own `LLKHF_INJECTED` / `LLMHF_INJECTED` flag to distinguish real hardware input from synthetic (`SendInput`-style) input — this is the anti-jiggler signal (`maybe_flag_synthetic_input`, `tracker.rs:749-784`), independent of idle accounting itself.
- `idle_seconds()` (`activity.rs:319-322`) is simply `now_ms() - last_input_ms` in whole seconds. There is no separate "idle detector" — it is purely time-since-last-hook-callback.
- **macOS/Linux**: `run_listeners()` (`activity.rs:247-260`) is an intentional no-op with an explicit comment that a correct `CGEventTap` implementation was deliberately not shipped without real hardware to verify it against. `last_input_ms` is therefore **only ever set once, at `ActivityMeter::new()` (`activity.rs:106,110`)**, and never updated again on those platforms.
- **`HOOKS_SUPPORTED`** (`activity.rs:324-332`) is `pub const HOOKS_SUPPORTED: bool = cfg!(windows);` — compile-time, not a runtime capability probe. It gates every caller that would *act* on idle time:
  - `tick_progress()` checks it at `tracker.rs:958` — off Windows, the active/idle split branch is **never taken**; every tick is unconditionally credited to `active_elapsed` (`tracker.rs:961-963`), i.e. idle detection silently defaults to "never idle," not "always idle." A non-Windows agent (if one existed in the field) would never show idle time or trigger escalation at all, and would never rewind active time either.
  - `tick_idle_escalation()` checks it at `tracker.rs:819-821` (`if !ActivityMeter::HOOKS_SUPPORTED { return false; }`) with an explicit comment: without this gate, `idle_seconds()` growing monotonically from process start (never reset, because no hook ever fires to reset it) would force-stop every non-Windows session ~15 minutes after launch regardless of real activity. So escalation is skipped entirely on non-Windows, not run against a stale signal.
  - Net effect: **on any platform without real input hooks, idle time is a fiction that reads as zero forever** — the agent behaves as if the user is always active. This is a known, explicitly-documented gap, not a hidden one.

### 2. Tick cadence

| Constant | Value | File:line | Meaning |
|---|---|---|---|
| `SESSION_POLL_SEC` | 5s | `constants.rs:18` | `loop_run()` sleeps this long between `tick()` calls (`tracker.rs:320`) |
| `SESSION_SYNC_INTERVAL_SEC` | 20s | `constants.rs:30` | How often a `"sync"` POST actually reaches the server (`tracker.rs:708`, `1033`) |
| `credited_seconds()` clamp | `SESSION_POLL_SEC * 4` = 20s | `tracker.rs:916-918` | Per-tick credit is real wall-clock elapsed time since the last credited tick (not an assumed fixed interval), clamped so a sleep/hibernate gap can never be banked as active work in one tick |
| `APP_LOG_INTERVAL_SEC` | 15s | `constants.rs:19` | App-slice/URL capture cadence |
| `DISPLAY_NAME_REFRESH_INTERVAL_SEC` / `ACTIVITY_SCORING_REFRESH_INTERVAL_SEC` | 30 min each | `constants.rs:38,43` | Periodic pulls of server-tunable display-name map and scoring/idle-threshold calibration |

Every `tick()` (`tracker.rs:376-747`) fetches the session from the server (`fetch_session()`, `tracker.rs:429`) — so the tick loop is not free-running against local state alone; it re-syncs against server truth every 5 seconds when reachable. Local counters (`active_elapsed`/`idle_elapsed`) accumulate purely from wall-clock deltas via `credited_seconds()` and are **not** dependent on the 5s poll actually succeeding (see the network-failure case below).

### 3. Full idle escalation state machine

> ### 🔴 Correction (fortify pass): this entire section described removed code
>
> The four-stage warn/alert/stop machine below **no longer exists in the agent.**
> It was replaced by a single per-project threshold that stops and rewinds
> immediately, with no notification stages ahead of it. Verified directly:
>
> - `tick_idle_escalation` now takes one `idle_threshold_sec` and, the moment
>   `idle_for >= idle_threshold_sec`, goes straight to stop + rewind — there is
>   no intermediate branch at all (`tracker.rs:847-874`). Its own doc comment
>   says so: *"no separate org-wide warn/alert stages ahead of it"*
>   (`tracker.rs:805-811`).
> - `IdleWatch.stage` only ever holds **0** (reset, `tracker.rs:849`) or **3**
>   (stopped, `tracker.rs:902`). Stages 1 and 2 are never assigned anywhere.
> - `valid_idle_thresholds` (plural, the `warn < alert < stop` ordering check)
>   is gone. What exists is `valid_idle_threshold` — singular, and the whole
>   body is `threshold_sec > 0` (`tracker.rs:173-175`).
> - `apply_idle_thresholds` takes a **single** `threshold_sec`
>   (`tracker.rs:210-214`).
> - `IDLE_FLAG_WARN_SEC` / `IDLE_FLAG_ALERT_SEC` / `IDLE_FLAG_STOP_SEC` no
>   longer exist in `constants.rs`.
> - The agent no longer even **fetches** the trio: `fetch_activity_scoring_settings`
>   reads only `saturationEvents`, `windowMs`, `screenshotMinDelaySec`,
>   `screenshotMaxDelaySec` and `idleThresholdSec` (`scoring.rs:39-45`).
>
> **Vestigial data, worth a cleanup decision:** `activity_scoring_settings`
> still carries `idle_warn_sec` (300), `idle_alert_sec` (600) and
> `idle_stop_sec` (900), all `NOT NULL` with `CHECK (... > 0)`
> (`ensure-lookup-schema.js:971-973`), and management can still edit them. No
> client reads them any more. They should either be removed or have their
> now-inert status documented, so nobody tunes a value expecting an effect.
>
> The corrected behaviour is a two-state machine:
>
> | Stage | Condition | Action taken |
> |---|---|---|
> | 0 (working) | `idle_for < idle_threshold_sec` — the project's own allowance | Clears any prior stop state, records `active_at_last_input = active_total` as the rewind point (`tracker.rs:847-855`) |
> | 3 (stopped) | `idle_for >= idle_threshold_sec` | **Immediately** rewinds active time to `active_at_last_input`, POSTs `"stop"`, ends the session (`tracker.rs:857-902`) |
>
> Everything below this box is retained for history but should be read as
> superseded wherever it mentions warn/alert.

`tick_idle_escalation()` — `tracker.rs:794-900`. Stages, in `IdleWatch.stage` (`tracker.rs:92-96`):

| Stage | Threshold constant | Default | Action taken |
|---|---|---|---|
| 0 (working) | `idle_for < idle_threshold_sec` (the project's own allowance) | project-configurable, default 450s | Clears any prior warning, records `active_at_last_input = active_total` as the rewind point (`tracker.rs:829-836`) |
| 1 (warn) | `idle_warn_sec` | 300s (5 min) | `emit_status("Idle — no activity detected")` only (`tracker.rs:894-897`) |
| 2 (alert) | `idle_alert_sec` | 600s (10 min) | `emit_status("Still idle — timer will stop soon...")` only (`tracker.rs:890-893`) |
| 3 (stopped) | `idle_stop_sec` | 900s (15 min) | Rewinds active time, POSTs `"stop"`, ends the session (`tracker.rs:839-887`) |

**Threshold sourcing**: the warn/alert/stop trio is **org-wide**, stored in `activity_scoring_settings` (`Dashboard-Backend/src/lib/postgres/ensure-lookup-schema.js:970-973`: `idle_threshold_sec` default 60, `idle_warn_sec` default 300, `idle_alert_sec` default 600, `idle_stop_sec` default 900), editable only by management (`Dashboard-Backend/src/modules/activity/scoring-settings.js:33-72`, requires `isManagementRole`), pulled every 30 min via `fetch_activity_scoring_settings()` → `apply_idle_thresholds()` (`tracker.rs:216-223, 362-373`), and refused wholesale (not partially) unless `warn < alert < stop` (`valid_idle_thresholds`, `tracker.rs:173-175`; same check server-side at `scoring-settings.js:49-53`). Compile-time fallbacks are `IDLE_FLAG_WARN_SEC=300`, `IDLE_FLAG_ALERT_SEC=600`, `IDLE_FLAG_STOP_SEC=900` (`constants.rs:89,91,93`).

The **per-project allowance** (`idle_threshold_sec_for_project` in `TickState`, `tracker.rs:127`) is a *completely separate* setting: `projects.idle_time_seconds`, default **450s / 7.5 minutes** (`ensure-lookup-schema.js:1091,1109`; same default echoed in `Dashboard-Backend/src/modules/tasks/task-time-tracking.js:263` and `Dashboard-Backend/src/modules/activity/routes.js:253`, and mirrored as the Rust deserialization fallback `default_idle_time_seconds() -> 450` at `Tauri-App-Extension/src-tauri/src/types.rs:295-300`). It is configured per project via a free-text hours/minutes picker in the project modal (`Dashboard-Web/features/projects/components/modals/project-modal.tsx:1137-1183`; default `"7.5"` minutes at line 165) with **no upper bound** — the value sent to the API is only floored at 0 (`Math.max(0, Math.round((Number(addForm.idleTimeMinutes) || 0) * 60))`, line 305).

**🔴 Superseded by the correction box above — there are no warn/alert stages to skip.** The analysis below described the removed three-stage design; the allowance is now the single stop threshold, so "skipping" is not a failure mode, it is the only behaviour. Retained for history.

**Confirmed: the warn stage (and, for large enough allowances, the alert stage too) can be skipped.** `tick_idle_escalation` only starts evaluating the warn/alert/stop thresholds once `idle_for >= idle_threshold_sec` (the allowance) — see the early-return at `tracker.rs:829-836`. The very first tick where that's true, `idle_for` is already approximately equal to the allowance. If the allowance exceeds `idle_alert_sec` (600s/10min), that first evaluation already satisfies the alert condition (`tracker.rs:890`, checked before the warn `else if` at `tracker.rs:894`), so stage jumps straight from 0 to 2, **skipping warn entirely**. If the allowance exceeds `idle_stop_sec` (900s/15min), the first evaluation can satisfy the stop condition (`tracker.rs:839`) directly, skipping **both** warn and alert — the timer just stops with no prior notification at all. There is **no validation anywhere** tying `projects.idle_time_seconds` to the org-wide `idle_warn_sec`/`idle_alert_sec`/`idle_stop_sec` — the only ordering constraints that exist are `idle_warn_sec < idle_alert_sec < idle_stop_sec` among themselves (`scoring-settings.js:49-53`, `tracker.rs:173-175`); the per-project allowance is never checked against them, client or server side.

The reported project's allowance is **exactly 10 minutes = 600s = the default `idle_alert_sec`**. On this project specifically, the first idle tick past the 10-minute allowance would land stage directly at "alert," skipping "warn" — confirmed for the exact configuration in the bug report (though moot for the actual reported incident, since the observed 6-minute idle stretch never reached the 10-minute allowance at all).

**What each stage does to the numbers**:
- Stages 0-2 do not touch active/idle totals at all — they are purely `emit_status()` notifications for the UI.
- Stage 3 (`tracker.rs:839-887`) calls `rewind_active()` (`tracker.rs:1124-1127`): `rewound = min(active_at_last_input, active_total)`, i.e. the active total is rolled back to whatever it was at the last real input — reversing not just the escalation window itself but also the allowance minute(s) `tick_progress` had already credited as active before the escalation logic's own threshold kicked in (this is called out explicitly in the doc comment at `tracker.rs:786-792`). Both directions are clamped (`saturating_sub`, `.min()`) so a stale/out-of-order snapshot can never mint or destroy hours.
- The rewound total and the idle total are POSTed as `"stop"` (`tracker.rs:854-866`). If that POST fails, it is captured in `PendingStop` (`tracker.rs:79-85`) and retried every tick until delivered (`tracker.rs:386-406`) — during which the tick loop does **nothing else** (no `fetch_session`, no other capture) to prevent the exact bug this guards against: a task-id mismatch on the next tick re-baselining from the server's still-active, pre-rewind total and silently resuming tracking with the idle rewind never applied.

### 4. Pause/resume and idle accounting

- `pause()` (`tracker.rs:268-277`) posts `action:"idle"` to the server with the current cumulative active/idle totals, unchanged, then sets `paused=true`. It does **not** reset any counters.
- While paused, `tick()` short-circuits entirely into `tick_paused()` (`tracker.rs:411-414`, function body `995-1035`), which:
  - Credits the **entire** wall-clock delta to `idle_elapsed` — unless `idle_time_disabled` is set, in which case the paused time is credited to **neither** bucket (explicitly not active either — see the comment at `tracker.rs:1002-1009`: crediting a break as active would "silently mint work hours").
  - Periodically re-syncs (`SESSION_SYNC_INTERVAL_SEC` cadence) purely to keep `updated_at` fresh so the paused session survives the abandoned-session sweep through a long break (see lifecycle table below).
  - Never touches `status` — `pause()` already set it server-side to `"idle"`.
- `resume()` (`tracker.rs:279-288`) posts `action:"resume"` with the current totals and clears `paused`. The idle escalation clock is effectively irrelevant while paused (the whole `tick_idle_escalation` path is skipped because `tick()` returns early into `tick_paused` before reaching it), so a long break does not trigger the escalation/rewind logic — the break itself is expected, tracked, unrewound idle time.

### 5. App restart / crash mid-session

Two independent recovery layers:

- **PS-1/PS-2, local crash-safety** (`Tauri-App-Extension/src-tauri/src/agent/progress_store.rs`): every credited tick calls `set_task_progress()` (`tracker.rs:973-993`), which — in addition to updating the in-RAM `task_progress` — atomically writes `PersistedProgress {session_id, task_id, active_seconds, idle_seconds}` to disk (temp-file + rename, `progress_store.rs:26-34`) scoped to the current session id. On the next task/session transition, `tick()` reconciles the freshly-fetched server baseline against this on-disk mirror with a `max()` on both active and idle (`tracker.rs:617-621`) — "same GREATEST-style rule the server already applies for sync" — so a crash between two 20-second syncs never displays *less* than what was last actually shown, but strictly scoped: a leftover file from an already-closed session is discarded if `session_id`/`task_id` don't match (`tracker.rs:618`). `reset_task_progress()` (`tracker.rs:1086-1116`) clears this file on every clean session end (`progress.clear()`, line 1115).
- **Server-side abandonment recovery** (`try_recover_lost_session`, `tracker.rs:1037-1084`): if the server reports no active session on a tick where the agent still believes it was tracking (and the stop wasn't user-initiated — `expect_stop` flag, `tracker.rs:42-47,260-262`), the agent re-POSTs `"start"` carrying the local `active_baseline + active_elapsed` / `idle_baseline + idle_elapsed` forward as the new session's starting point (`tracker.rs:1053-1077`), rather than discarding accumulated-but-unsynced time. This is what handles the server's own **abandoned-session sweep**: `Dashboard-Backend/src/modules/activity/agent-heartbeat.js:8` — `SESSION_STALE_MS = 5 * 60_000` (5 minutes, not 90 seconds as an earlier pass assumed) — any `agent`-sourced session in `active`/`idle` status whose `updated_at` is more than 5 minutes stale gets force-closed (`isSessionAbandoned`, lines 34-41; `closeAbandonedSession`, lines 43-54) by a sweep that runs every 30 seconds (`abandoned-session-sweep.service.js:5,18-30`). A genuine crash (no more ticks, no more syncs at all) is *not* recoverable this way — there is nothing left running to notice the session was closed and re-POST "start"; the session simply sits closed server-side at whatever active/idle numbers its last successful sync recorded, and the on-disk `PersistedProgress` file becomes orphaned (harmless — it never matches a new session id and is eventually overwritten by the next real session, or cleared by `reset_task_progress` if the agent later reconciles a "no session" state).

### 6. `disableIdleTime` — real flag, per-project

- Column: `projects.disable_idle_time BOOLEAN NOT NULL DEFAULT false` (`ensure-lookup-schema.js:1090`).
- Read into the agent two ways depending on session shape (`tracker.rs:589-594`):
  - Task-anchored sessions: via `fetch_task_time_tracking()`, which attaches the owning project's setting to the task-tracking response (`task-time-tracking.js:262`, `Boolean(project?.disable_idle_time ?? false)`).
  - Task-less ("calling project") sessions: the session payload itself carries `disableIdleTime`/`idleTimeSeconds`, attached only in that branch by `normalizeSession()` (`Dashboard-Backend/src/modules/activity/routes.js:247-268`, specifically the `if (!data.task_id && data.project_id)` guard at line 250 and the conditional spread at line 267).
- Effect when `true`, applied consistently in three separate places (each has its own explicit "ID-3" comment noting this was fixed incrementally, i.e. it was easy to miss one spot):
  - `tick_progress()` (`tracker.rs:955-957`): every tick's delta goes to `active_elapsed`; there is no idle bucket to fall into at all.
  - `tick_idle_escalation()` (`tracker.rs:809-811`): returns `false` immediately — no warn/alert/stop/rewind for this project, ever.
  - `tick_paused()` (`tracker.rs:1014-1016`): break time is credited to **neither** active nor idle (not even idle) while paused.
- On session/task reset, the flag is defensively reset to `false` and the threshold to the compile-time default (`reset_task_progress()`, `tracker.rs:1103-1107`) so a stale disabled-project setting can never bleed into whatever starts next.

### 7. Double-count / boundary-tick risks

- **Boundary tick that straddles the idle threshold**: `tick_progress()` classifies the **entire** per-tick delta as either fully active or fully idle based on a single `idle_seconds() >= idle_threshold_sec` check taken at the end of the delta (`tracker.rs:955-964`) — there is no sub-tick splitting. Since ticks are ≤20s (the `credited_seconds` clamp) and the smallest configurable allowance can be far larger, in practice this rounds the crossing tick's ~5-20s either fully active or fully idle rather than pro-rating it. This is a minor, bounded misclassification (at most one tick's worth, ~5-20s) rather than a source of drift — it does not compound.
- **Idle escalation and `tick_progress` use the same threshold value but are separately evaluated**: both take `idle_threshold_sec_for_project` as a parameter (`tracker.rs:631-639` and `654-663`) and both read `self.activity.idle_seconds()` independently within the same `tick()` call. Since both reads happen in the same synchronous call with no intervening sleep, they cannot observe different `idle_seconds()` values in practice (same tick), so this is not a source of double-counting.
- **No overlap between active and idle accumulation**: `active_elapsed` and `idle_elapsed` are separate counters incremented by mutually exclusive branches of the same `if` (`tracker.rs:955-964`) — a given tick's delta can only ever land in one or the other, never both, and never neither (except the `idle_time_disabled` case, which is active-only by design, and the paused case, which credits idle-only or neither).
- **Sync-time truncation, not idle-time**: the actual "under-counting" mechanism in this bug is not idle misclassification but the server-side `GREATEST`-based ceiling on `task_member_progress.active_seconds` (see next section) plus `activity_sessions.active_seconds`'s own non-decrease clamp (`updatePgSession`, `activity-events-postgres.service.js:534-570`) — both are monotonic-non-decreasing by design (to reject "unexplained" downward writes as a data-integrity guard), which is correct for normal operation but is exactly the mechanism that freezes a number once a *legitimate* rewind or cap sets it once and a later legitimate sync can't exceed it within the same capping window.

### 8. 🔴 The selected project's idle settings never reach a task-less session

**Confirmed broken by reading `tracker.rs`.** A session started against a
*project* rather than a task ignores that project's `idleTimeSeconds` and
`disableIdleTime` entirely, and idles out on the compile-time default instead.

The read itself is correct and is exactly where §6 says it is —
`idle_time_disabled` at `tracker.rs:606-611`, `idle_threshold_sec_for_project`
at `tracker.rs:612-620`, the latter falling back to the session's own
`idleTimeSeconds` for the task-less shape precisely as `normalizeSession()`
intends. The defect is the condition those lines sit inside:

```rust
// tracker.rs:572
if state.task_id.as_str() != session_task_id {
```

**The settings are refreshed on a change of *task*, never on a change of
*session*.** Session identity is tracked separately and independently, at
`tracker.rs:552` (`if state.current_session.as_str() != session_id`), and that
branch does no settings work at all.

For a task-less session `session_task_id` is always `""`. `reset_task_progress()`
clears `state.task_id` to `""` as well (`tracker.rs:1105`). So on the next
task-less session the guard evaluates `"" != ""` → **false**, the whole block is
skipped, and `idle_threshold_sec_for_project` keeps whatever the reset left in
it: `IDLE_THRESHOLD_SEC`, the compile-time constant (`tracker.rs:1114`).

Two concrete consequences:

- **Wrong threshold, 7.5× too aggressive.** `IDLE_THRESHOLD_SEC` is **60s**
  (`constants.rs:87`), while the product default a project is created with is
  **450s** (7.5 min) — the value `types.rs:298-300` and `work.rs:470` both use
  as their own fallback, explicitly documented there as matching
  `ensure-lookup-schema.js`. A task-less session therefore hits its idle
  threshold after one minute of no input, no matter what the project says.
- **`disableIdleTime` is ignored on this path too.** It is reset to `false` at
  `tracker.rs:1113` and re-read only inside the same skipped block, so a project
  that deliberately turned idle enforcement *off* still gets idled out.

**Severity, corrected upward after the §3 fortify pass.** Because there are no
warn/alert stages any more, crossing the threshold is not a notification — it is
an immediate `"stop"` plus a rewind of the active total back to
`active_at_last_input` (`tracker.rs:857-902`). So this is not "the agent warns
too early." It is: *a task-less session stops itself after 60 seconds away from
the keyboard and reverses the time credited since the user last touched the
machine.* From the member's side that reads as the timer quitting on its own and
losing minutes.

**It does not affect every task-less session.** The guard compares task ids, so
which transitions are broken depends on what `state.task_id` held before:

| Prior `state.task_id` | New `session_task_id` | Guard fires? | Settings used |
|---|---|---|---|
| `""` — fresh boot (`TickState::new`, `tracker.rs:151`) or after any `reset_task_progress` | `""` (task-less) | **no** | 🔴 stale / 60s default |
| `"task-1"` — switching to project-level inside one live session | `""` (task-less) | yes | ✅ session payload, correct |
| `""` | `"task-1"` | yes | ✅ `fetch_task_time_tracking` |
| `"task-1"` | `"task-2"` | yes | ✅ correct |
| unchanged across `try_recover_lost_session` | same id | **no** | 🔴 stale (see below) |

The first row is the everyday case — every task-less session that starts from a
clean state — and the second row is why manual testing could easily miss it:
switching from a task to project-level *within* a live session works correctly.

**Compounding: `try_recover_lost_session` refreshes nothing either.** It POSTs a
real `"start"` and adopts a genuinely new session id (`tracker.rs:1070-1077`),
but never clears `state.task_id` and never re-reads idle settings. The next tick
therefore compares an unchanged task id against itself, skips the block, and the
recovered session runs on whatever was in memory. For a task-anchored recovery
that is usually harmless (same task, same project, same settings); for a
task-less recovery it re-enters the broken path.

**This also corrects §6's last bullet**, which describes the reset to the
compile-time default as purely defensive ("so a stale disabled-project setting
can never bleed into whatever starts next"). That is true only when a
subsequent read actually happens. On the task-less path no such read is
reachable, so the reset is not a safety net — it *is* the value the session runs
on.

**Related, worth deciding at the same time — three defaults for one number:**

| Location | Value | Notes |
|---|---|---|
| `constants.rs:87` `IDLE_THRESHOLD_SEC` | **60** | what the broken path actually falls back to |
| `types.rs:298-300` `default_idle_time_seconds()` | 450 | documented as the `ensure-lookup-schema.js` product default |
| `work.rs:470` `unwrap_or(450)` | 450 | deserialization fallback |

Separately, `reset_task_progress()` resets to the *compile-time* constant rather
than to `self.idle_threshold_sec` — the org-wide value `apply_idle_thresholds()`
keeps current from `fetch_activity_scoring_settings()` (`tracker.rs:406`). So a
refreshed org-wide threshold is discarded on every reset, even on the paths that
do re-read correctly.

**Why it shipped: the broken path has zero test coverage.** `tracker.rs`'s test
module contains exactly **one** session fixture — `ACTIVE_SESSION_WITH_TASK`
(`tracker.rs:1279`), which is task-anchored. The string `taskId` occurs twice in
the entire file: that fixture, and the production `.get("taskId")` at
`tracker.rs:567`. So every idle test — `tick_stops_the_timer_once_the_idle_escalation_deadline_passes`,
`tick_never_escalates_when_the_projects_idle_time_is_disabled`,
`tick_progress_reports_idle_once_the_threshold_is_crossed` — exercises the
task-anchored branch, which is correct. Nothing in the suite ever constructs a
session with no `taskId`. This is the same failure mode already recorded
elsewhere in this file for the `fetch_session`-mid-session self-deadlock
("never triggered before because this branch had zero test coverage"), and any
fix here must ship with a task-less fixture or it will regress silently.

### 8b. ⚠️ A project idle allowance of `0` stops every session instantly

Found while verifying §8, and independent of it — this one bites task-anchored
sessions too.

The org-wide path validates its threshold: `apply_idle_thresholds` refuses
anything not `> 0` via `valid_idle_threshold` (`tracker.rs:210-214, 173-175`).
**The per-project path performs no validation at all** — `tracker.rs:612-620`
takes `idleTimeSeconds` exactly as received.

Nothing upstream guarantees it is positive:

- `projects.idle_time_seconds INTEGER NOT NULL DEFAULT 450`
  (`ensure-lookup-schema.js:1091,1109`) has **no `CHECK (... > 0)`** — notable
  because every `activity_scoring_settings` idle column right next to it *does*
  (`ensure-lookup-schema.js:970-973`).
- The project modal floors at zero rather than rejecting it:
  `Math.max(0, Math.round((Number(addForm.idleTimeMinutes) || 0) * 60))`
  (`project-modal.tsx:305`), and `Number("") || 0` is `0` — so clearing the
  field and saving stores `0`.
- `normalizeSession` uses `Number(project?.idle_time_seconds ?? 450)`
  (`routes.js:253`); `??` only catches `null`/`undefined`, so a stored `0`
  passes straight through.

With `idle_threshold_sec == 0`, the guard `if idle_for < idle_threshold_sec`
(`tracker.rs:847`) can never be true, so `tick_idle_escalation` takes the stop
branch on the **very first tick** — the session stops and rewinds before any
work is credited, every time, and the member cannot track at all on that
project. Worth fixing at the same time as §8, in the same place: validate the
per-project value on read and fall back to the org-wide threshold, plus a
`CHECK` on the column and a minimum in the modal.

**Fix shape for §8 (not yet applied):** key the settings refresh off session
identity as well as task identity — either move the read into the
`state.current_session != session_id` branch at `tracker.rs:552`, or widen the
`tracker.rs:572` guard to fire when either changed, and have
`try_recover_lost_session` invalidate the cached settings so the next tick
re-reads. Whichever is chosen, the task-less branch already has a correct source
to read from (the session payload, which `normalizeSession` populates properly —
verified at `routes.js:248-256`), so this is a control-flow fix, not new
plumbing. Pair it with `valid_idle_threshold` on the per-project value per §8b,
and with a task-less test fixture.

---

## Timer/budget capping mechanics

### The remainder sources (`computeTimerAllowance`, `Dashboard-Backend/src/modules/tasks/timer-limit.service.js:195-290`)

For a normal (non-shift) task-anchored sync, up to **six** independent "seconds remaining" values are computed and the **smallest** governs (`Math.min(...remainders)`, line 278) — there is no hierarchy or override between them, whichever is smallest wins:

| # | Source | Computed from | Line |
|---|---|---|---|
| 1 | Effective daily cap (task daily hours, possibly tightened by the member's own daily-limit hours via `computeEffectiveDailyCap`) minus seconds already worked on **this task today** | `daily_member_task_active_seconds` | `timer-limit.service.js:245-255` |
| 2 | Member's global daily limit minus seconds worked **today across every project** | `daily_member_active_seconds` (see cross-project note below) | `timer-limit.service.js:257-259` |
| 3 | Member's global weekly limit minus seconds worked **this week across every project** | `daily_member_active_seconds` | `timer-limit.service.js:261-263` |
| 4 | Task's total estimated duration minus total seconds already consumed on the task (own + other assignees if `shared_task_budget`) | `task_member_progress` rows | `timer-limit.service.js:265-267` |
| 5 | Project's per-person budget remainder (only if the project budget is "Hours based" + "per_person" scope) | `activity_sessions` + manual time entries, scoped to this member/project | `timer-limit.service.js:132-143, 269-271` |
| 6 | Project-member-limit record remainder (an explicit per-member cap row on the project, daily/weekly/never-resetting) | `activity_sessions` + manual time entries, scoped to this member/project | `timer-limit.service.js:168-193, 273-275` |

`enforceTimerAllowanceOnSync` (`timer-limit.service.js:324-348`) computes this ceiling twice — once from the member's *current* cumulative (to decide whether to reject a `start`/`resume`, lines 329-333) and once from a hypothetical zero baseline (to get the absolute session ceiling, `maxCumulativeActiveSeconds`, lines 335-338) — then simply clamps the reported `activeSeconds` down to that ceiling if it's exceeded (lines 340-345), returning `capped: true`.

### The plateau

`upsertTrackingRowPg` (`Dashboard-Backend/src/lib/postgres/task-member-progress.service.js:63-105`) writes the capped value with:

```sql
active_seconds = GREATEST(task_member_progress.active_seconds, EXCLUDED.active_seconds)
```

on every action except `"stop"` (which passes `allowDecrease: true`, using `EXCLUDED.active_seconds` verbatim — see `task-time-tracking.js:184`). Once the reported value is capped at, say, 3000s and written once, **every subsequent sync's capped value must exceed 3000 to move the stored row at all** — and while the same ceiling remains binding (same day, same limit not yet reset/raised), the freshly-computed `cappedActive` recomputes to the same ceiling every time, so the row is stuck exactly there until whichever limiting window resets (daily/weekly rollover) or a different, currently-larger remainder becomes the new binding minimum.

**Important nuance found in this pass**: this plateau is specific to `task_member_progress.active_seconds` — the number surfaced as task/assignment progress (`aggregateTaskProgress`, `task-time-tracking.js:66-111`, which writes `tasks.total_active_seconds`). It does **not** affect the raw accounting the caps themselves are computed from:
- `activity_sessions.active_seconds` is updated with the **uncapped, raw** value the agent reports (`routes.js:697-704` for `"sync"`), subject only to a non-*decrease* clamp (`updatePgSession`, `activity-events-postgres.service.js:534-570`) — it has a floor, not a ceiling, so it keeps growing with the real session.
- Every such update also records the **delta** into `daily_member_active_seconds` / `daily_member_task_active_seconds` (`recordDailyActiveSecondsDelta`, `activity-events-postgres.service.js:599-625`, called at line 592) — and this is what remainder sources #1-#3 above are actually computed from.
- So the member's daily/weekly/task-daily allowances are correctly and continuously debited by the *real* worked time even while `task_member_progress`'s displayed number is frozen at its cap. The bug is a **display/aggregation freeze**, not a double-counting or under-billing of the member's actual allowance consumption.

### Cross-project pooling (confirmed correct, not a bug)

`sumDailyMemberActiveSeconds` (`activity-events-postgres.service.js:627-636`) sums `daily_member_active_seconds.active_seconds` filtered only by `member_id` and day range — **no project or task filter**. This is a genuinely global, cross-project pool by design: if a project's own budget/limit (#4, #5, or #6 above) is the smallest remainder, the member's global daily/weekly quota is barely touched and remains fully available for other projects that same day. If the member's global limit is the smallest remainder instead, it correctly reflects total usage summed across every project, task-anchored or task-less (recall `recordDailyActiveSecondsDelta` is called for every `activity_sessions` update regardless of whether the session has a `task_id` — line 592 passes `prev.task_id`, which is simply `null` for task-less sessions, but `daily_member_active_seconds` itself has no such filter). This matches the previously-established finding and is confirmed correct behavior, not a defect.

### Open design question (not a bug per se, flagged only)

There is no mechanism for a project-level override to "win" over the member's global limits, or vice versa — whichever of the six sources is numerically smallest at sync time silently governs, with no visibility into *which* source capped a given sync beyond the boolean `timerCapped` flag reaching the agent. Whether a project's own (larger) allowance should ever take precedence over a smaller global member limit — or the reverse — is a product decision this document does not attempt to resolve.

### Task-less sessions bypass capping and auto-stop entirely

`enforceTimerAllowanceOnSync`/`syncTaskTimeTracking` (and therefore all six remainder sources, `timerCapped`, and the daily/weekly delta recording tied to a task) only run when a `taskId` is attached to the sync call — gated at `routes.js:707-709` (`const syncTaskId = taskId || open?.task_id || null; if (syncTaskId && activeSeconds !== undefined ...)`). A project-level/task-less session never enters `syncTaskTimeTracking` at all, so it can run indefinitely with no `timerCapped` auto-stop from this mechanism. It is still subject to `checkProjectBudgetCap` (`routes.js:116-127`, invoked unconditionally whenever `sessionProjectId` is present, `routes.js:738-745`), which can independently set `budgetCapped` and trigger the agent's own stop (`tracker.rs:716-720`) — but only if the project has a financial budget configured with `stop_timers_when_reached` set. A task-less session on a project with no budget cap configured has no automatic stop mechanism at all beyond the member's own global daily/weekly limits (still recorded via `activity_sessions` → `daily_member_active_seconds`, but nothing currently reads those to force-stop a task-less session mid-flight — only `enforceTimerAllowanceOnSync`, which this path never reaches, would reject/cap on those).

---

## Session lifecycle cases

| Case | What happens locally (agent) | `activity_sessions` | `task_member_progress` | Known gap/risk |
|---|---|---|---|---|
| **Start, with task** | `fetch_task_time_tracking` re-baselines `active_baseline`/`idle_baseline` from server totals; `idle_time_disabled`/allowance fetched fresh (`tracker.rs:555-625`) | Row created/reactivated via `post_session_action("start")` (`routes.js:588-619`) | Row upserted on first sync via `enforceTimerAllowanceOnSync` + `upsertTrackingRowPg` | None known |
| **Start, task-less (project)** | Baseline pulled from the session's own `activeSeconds`/`idleSeconds` fields, not a task-tracking fetch (`tracker.rs:566-578`) | Same as above, keyed by `project_id` | **Never written** — `syncTaskId` is empty (`routes.js:707`) | No `timerCapped`/task-level cap ever applies; only project budget cap can stop it. **Also: the project's `idleTimeSeconds`/`disableIdleTime` are never read on this path** — the refresh is gated on a task-id change that can't fire when the task id is always `""`, so the session idles on the 60s compile-time default — see Idle-time mechanics §8 |
| **Start, idle time disabled** | `idle_time_disabled=true` fetched from project/task; all subsequent ticks credited 100% active, no escalation possible | Same as normal start | Same as normal start | Idle allowance/escalation UI still shows "0 idle" — by design |
| **Tick during tracking, under allowance** | `tick_progress` credits `active_elapsed`; `tick_idle_escalation` resets stage to 0 and records `active_at_last_input` (`tracker.rs:829-836`) | Updated only at the next `sync` (every 20s) | Updated only at the next task sync | None |
| **Tick during tracking, over allowance (idle)** | `tick_progress` credits `idle_elapsed`; `tick_idle_escalation` may move to warn/alert stages (`tracker.rs:890-897`) | Same, on next sync | Same, on next task sync | Warn/alert stage can be skipped if the project allowance exceeds the corresponding org-wide threshold — see Idle-time mechanics §3 |
| **Idle escalation reaches stop (15 min default)** | `active_total` rewound to `active_at_last_input`; `"stop"` POSTed immediately (not waiting for the next sync tick); local state fully reset (`tracker.rs:839-887`, `654-680`) | `active_seconds` written **down** via `allowDecrease:true` (`routes.js:681-696`) | Also written down (`allowDecrease: action==="stop"`, `task-time-tracking.js:184`) | If the "stop" POST fails, `PendingStop` retries every tick with all other tick work suspended (`tracker.rs:58-63, 386-406, 868-881`) — tracking stays fully halted client-side until delivered, by design, to avoid re-crediting the reversed idle time |
| **Pause (break)** | `pause()` posts `action:"idle"` with current totals unchanged; `tick_paused` credits 100% of wall-clock delta to idle (or neither, if idle disabled) (`tracker.rs:268-277, 995-1035`) | `status` → `"idle"`, totals otherwise untouched until next paused-sync | Untouched until resumed and a task sync occurs | None found |
| **Resume** | `resume()` posts `action:"resume"`; tick loop resumes normal `tick()` path | `status` → `"active"` | Untouched until next sync | None found |
| **Manual stop** | `stop_session()` (`controller.rs:999-1032`) posts `"stop"` directly, bypassing the tick loop; sets `expect_stop` first (`controller.rs:1010`) so the next tick doesn't mistake this for server-side abandonment | `active_seconds` allowed to decrease (`allowDecrease:true`) | Allowed to decrease | Manual stop from the controller passes `project_id: None` regardless of session type (`controller.rs:1016`) — harmless for the `"stop"` action itself (only needs `open.id`), but means `budgetCapped` is not (re)checked on a manual stop, which is immaterial since the session is already ending |
| **Auto-stop from idle escalation** | See "reaches stop" row above | Written down via rewind | Written down via rewind | Same `PendingStop` retry risk |
| **Auto-stop from timer/budget cap** | On the periodic `"sync"` response, `timerCapped`/`budgetCapped` seen → agent immediately POSTs `"stop"` with the **already-capped** totals it just learned about, resets state (`tracker.rs:697-746`) | Updated to capped totals (this stop call does not pass `allowDecrease`, so it can only move up from whatever was last stored, not down — capped totals are typically ≥ stored since the cap only ever clamps the *incoming* value, not force a decrease) | Row already at its `GREATEST`-clamped ceiling from the sync that triggered this | This is exactly the plateau mechanism — see Timer/budget capping section |
| **App crash/kill mid-session** | No more ticks fire; whatever was last successfully synced (≤20s stale) is what's stored; `PersistedProgress` on disk holds the true last-credited local total | Frozen at last successful sync's values until... | ...the abandoned-session sweep closes the session server-side 5 minutes after the last `updated_at` (`agent-heartbeat.js:8,34-41`, swept every 30s, `abandoned-session-sweep.service.js:5,18-30`) | Up to ~5 minutes of real-but-unsynced work between the last sync and the crash can be lost if the app never restarts to reconcile the on-disk `PersistedProgress` against a still-open session (a genuine crash with no restart has nothing to run the reconciliation code in `tracker.rs:605-622`) |
| **Network failure during sync** | `fetch_session()` fails → agent keeps capturing under the last known session, still ticking `active_elapsed`/`idle_elapsed` locally from wall-clock time, still attempting screenshot/app-slice capture (queued via `EventQueue` on failure, `tracker.rs:436-465`, `queue.rs:39-63`) | Not updated until connectivity returns | Not updated until connectivity returns | Regular `"sync"` action failures are not queued/retried by `EventQueue` (that only buffers screenshot/app-slice *events*, not session-sync actions) — a missed sync is simply superseded by the next successful one 20s later, carrying the accumulated total forward, so no session-sync data is lost, only delayed |
| **Reconnect after offline** | Next successful `fetch_session()` re-baselines if the task changed; `EventQueue.flush()` (`tracker.rs:326-333`, `queue.rs:65-...`) resends any buffered screenshot/app-slice batches, throttled to once per 30s (`QUEUE_FLUSH_INTERVAL_SEC`, `tracker.rs:25`) | Next `sync` carries the full accumulated total (never lost, since it was tracked locally the whole time) | Next task sync likewise | None found — this path is well-covered by tests (`tracker.rs` `#[cfg(test)]` module, e.g. `tick_keeps_capturing_under_the_last_known_session_when_fetch_session_fails`) |

---

## What's confirmed working correctly vs. confirmed broken / suspicious / needs a product decision

| Confirmed working correctly | Confirmed broken / suspicious / needs a product decision |
|---|---|
| Idle allowance crediting under threshold as active — `tracker.rs:955-964` | `task_member_progress.active_seconds` plateaus permanently (within a capping window) once `GREATEST`-clamped — `task-member-progress.service.js:63-105` |
| Idle escalation no-op below the project allowance — `tracker.rs:809-836` | On-screen clock (`liveActiveSeconds`/`liveTaskActiveSeconds`) is a local `+1/sec` interval merged via `Math.max` — cannot reflect a server-side freeze — `App.tsx:707-716, 712-716, 718-727, 723-727` |
| Idle rewind on stop reverses exactly the idle stretch (clamped both directions) — `tracker.rs:839-887, 1124-1127` | 🔴 **Stale row, corrected:** warn/alert stages no longer exist, so nothing can "skip" them — the project allowance is now the single stop threshold and crossing it stops + rewinds immediately (`tracker.rs:847-902`). See the correction box in Idle-time mechanics §3. The vestigial `idle_warn_sec`/`idle_alert_sec`/`idle_stop_sec` columns survive in `activity_scoring_settings` but no client reads them |
| `HOOKS_SUPPORTED` gating prevents false idle/false escalation on non-Windows builds — `activity.rs:324-332`, `tracker.rs:819-821, 958` | Non-Windows builds have **no** real idle detection at all — idle time is always 0, escalation never fires — `activity.rs:247-260` (explicitly documented gap) |
| Cross-project global daily/weekly member pool is correctly summed with no project filter — `activity-events-postgres.service.js:627-636` | Six independent remainder sources combined via bare `Math.min`, no hierarchy/override — whichever project or global limit is smallest silently wins — `timer-limit.service.js:195-290` |
| `activity_sessions.active_seconds` and the `daily_member_*` delta tables are never capped — they track the true raw worked time — `activity-events-postgres.service.js:534-570, 592, 599-625` | Task-less (project-level) sessions never pass through `enforceTimerAllowanceOnSync`/task-cap logic at all — `routes.js:707-709` — only a configured project financial budget cap can stop them |
| PS-1/PS-2 crash-safe local progress mirror, scoped correctly to session+task id — `progress_store.rs`, `tracker.rs:605-622, 973-993` | A true crash with no restart loses up to ~5 minutes of unsynced-but-real work (bounded by the abandoned-session sweep's `SESSION_STALE_MS`) — `agent-heartbeat.js:8` |
| `PendingStop` retry halts all other tick activity until an idle-triggered "stop" is confirmed delivered, preventing a silent re-credit of reversed idle time — `tracker.rs:58-63, 386-406, 868-881` | Manual stop from the controller always sends `project_id: None`, so `budgetCapped` is not re-checked on that path (currently immaterial, but asymmetric with the "sync" path) — `controller.rs:1016` vs `routes.js:738-745` |
| Pause/resume preserves accumulated totals and never resets to 0 — `tracker.rs:268-288` | Reported bug's exact plateau, 3000s, is consistent with *some* combination of the six remainder sources capping at that instant — which one cannot be determined from code alone, only from that account's live limit configuration and usage data |
| Task-anchored sessions do read the owning project's idle settings correctly, via `fetch_task_time_tracking` — `tracker.rs:606-620` | **Task-less (project) sessions never read the selected project's `idleTimeSeconds`/`disableIdleTime` at all** — the refresh is gated on a task-id change (`tracker.rs:572`) that cannot fire when the task id is always `""`; the session runs on `IDLE_THRESHOLD_SEC` = 60s instead of the project's value (product default 450s) — see Idle-time mechanics §8 |
| — | Three separate defaults exist for the same setting: `IDLE_THRESHOLD_SEC` = 60 (`constants.rs:87`) vs 450 in both `types.rs:298-300` and `work.rs:470`; and `reset_task_progress` resets to the compile-time constant rather than the org-wide value `apply_idle_thresholds` maintains (`tracker.rs:406, 1114`) |
| The org-wide idle threshold is validated before use — `apply_idle_thresholds` → `valid_idle_threshold(> 0)`, `tracker.rs:210-214, 173-175` | **The per-project idle allowance is never validated.** `projects.idle_time_seconds` has no `CHECK (> 0)` (unlike every neighbouring `activity_scoring_settings` column), the project modal floors at `0` rather than rejecting it (`project-modal.tsx:305`), and `?? 450` in `normalizeSession` doesn't catch a stored `0`. A `0` allowance makes `idle_for < 0` unsatisfiable, so the session stops and rewinds on its first tick — see Idle-time mechanics §8b |
| — | `try_recover_lost_session` adopts a new session id without clearing `state.task_id` or re-reading idle settings (`tracker.rs:1070-1083`), so a recovered session runs on whatever was cached — benign for task-anchored recovery, re-enters the §8 bug for task-less |
| — | The task-less session path has **no test coverage at all**: one fixture in `tracker.rs`'s suite (`ACTIVE_SESSION_WITH_TASK`, line 1279) and it is task-anchored, which is why §8 shipped unnoticed |
