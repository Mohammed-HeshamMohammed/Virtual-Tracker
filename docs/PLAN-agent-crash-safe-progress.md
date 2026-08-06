# Desktop Agent — Crash-Safe Progress & Per-Project Idle Config (Plan)

Scope: **Phase 0** — `Tauri-App-Extension/src-tauri/src/agent/tracker.rs` (`ActivityTracker`) and the small amount of `Dashboard-Backend` needed to reconcile against it. **Phase 1** — `Dashboard-Web`'s Projects page/modal, `Dashboard-Backend`'s project storage, and the same `tracker.rs` consuming a per-project idle setting instead of only the org-wide one.

**Origin of this plan.** The desktop agent is the *source of truth* for active/idle seconds while a session runs — it measures real wall-clock deltas and decides active-vs-idle locally (`tick_progress`, `tracker.rs:711`). But that truth only lives in RAM (`task_progress: Arc<Mutex<(Option<String>, u64, u64)>>`, `tracker.rs:39`). It only reaches the server on a periodic `sync` (every `SESSION_SYNC_INTERVAL_SEC` = 20s) or on a clean `stop` (`flush_and_stop_tracker`, `controller.rs:103`). Nothing persists it to disk in between.

**Failure mode.** Any unclean exit — crash, force-kill, Windows Update reboot, power loss, OOM-kill, "End Task" — between two syncs discards whatever active seconds accrued since the last successful sync (up to ~20s). On the next launch, the tracker re-baselines `active_baseline`/`idle_baseline` straight from the server's last-synced number (`tracker.rs:466`), with `active_elapsed` reset to 0. There's nothing local left to compare against, so the number the user sees drops to the server's stale value. Not the server *deciding* to rewind — the app losing its own uncommitted memory and the server correctly serving the last number it actually has.

This is a narrower, different bug than `TC-4`/`TC-6` in `docs/TAURI-AGENT-IMPROVEMENTS.md` (which cover the server clamping downward *writes*, and a failed idle-stop POST). This plan is about the write never being attempted in the first place because the process is gone.

Format matches the existing plan doc: stable task IDs, Problem / Files / Change / Acceptance / Verify / Depends on. No estimates or dates.

---

## Dependency map (all phases)

```
PHASE 0 — CRASH-SAFE PROGRESS
  PS-1 (persist progress locally) ── PS-2 (reconcile on restart)
  PS-1 ── PS-3 (flush more often / on signal)

PHASE 1 — PROJECT REFRESH + PER-PROJECT IDLE CONFIG  (independent of Phase 0)
  RF-1 (standalone)
  ID-1 (schema + API) ── ID-2 (General-tab UI) ── ID-3 (agent consumes it)
```

Phase 0 and Phase 1 don't touch the same code paths and can land in either order or in parallel. Within Phase 1, ID-1 → ID-2 → ID-3 is a strict pipeline: there's no UI to build against an API that doesn't exist yet, and no agent behavior to change against a value nothing ever sends it.

---

# Phase 0 — Crash-Safe Progress Persistence

PS-1 is the prerequisite for everything else in this phase — there is nothing to reconcile or flush faster without a local record to reconcile from.

---

### PS-1 🔴 Persist `task_progress` to disk on every credited tick

**Problem**

`task_progress` is written on every `tick_progress` call (`tracker.rs:729`, via `set_task_progress`) but only ever lives in the `Mutex`. The existing `EventQueue` (`queue.rs`) persists *events* (screenshots, app slices) for offline retry — there is no equivalent for the active/idle counters themselves.

**Files**
- `Tauri-App-Extension/src-tauri/src/agent/tracker.rs` — `set_task_progress`, `ActivityTracker::new`, `TickState`
- `Tauri-App-Extension/src-tauri/src/config.rs` — new `Settings.progress_path` (same pattern as `queue_path`)
- `Tauri-App-Extension/src-tauri/src/agent/progress_store.rs` — new, small file-backed store

**Change**

A single small JSON file next to the existing `queue.jsonl`/`store.json`, holding exactly what `task_progress` holds plus the session it belongs to:

```rust
#[derive(Serialize, Deserialize)]
struct PersistedProgress {
    session_id: String,
    task_id: Option<String>,
    active_seconds: u64,
    idle_seconds: u64,
    saved_at_unix: u64, // wall clock, for staleness checks only — never fed into the credited-seconds math
}
```

Write it from `set_task_progress` (same call site as the in-memory update, so the two can never drift) with an atomic write (write to `.tmp`, rename over) so a crash mid-write never leaves a corrupt/partial file. Writing every ~5s tick is one small local file write — cheap, no network — not the 20s network sync.

Clear the file in `reset_task_progress` (`tracker.rs:745`), mirroring the existing `(None, 0, 0)` reset already done for the in-memory value.

**Acceptance**
- [ ] Every `set_task_progress` call durably persists the same values to disk, atomically
- [ ] The file is removed/cleared whenever `reset_task_progress` runs
- [ ] Killing the process (`kill -9` / Task Manager "End task") mid-session leaves a progress file no more than one tick stale
- [ ] Malformed or missing progress file on read is treated as "nothing to recover" — never a crash or a panic

**Verify**
1. Reproduce first: start a session, `kill -9` the agent process after 2 minutes, confirm today's code has no on-disk record of the accrued time at all.
2. After: same kill, inspect the progress file — it holds active/idle seconds within one tick of what the UI last showed.

**Depends on** — nothing.

---

### PS-2 🔴 Reconcile local persisted progress against the server baseline on (re)start

**Problem**

Without this, PS-1's file is write-only — the crash-recovery value never gets picked back up, and the bug described above is unchanged. The re-baseline logic at `tracker.rs:450-475` (fires when `state.task_id` changes, including on a fresh process start) currently always trusts the server's `fetch_task_time_tracking` result as the baseline with `active_elapsed` reset to 0.

**Files**
- `Tauri-App-Extension/src-tauri/src/agent/tracker.rs` — the re-baseline block in `tick` (`:450-475`)

**Change**

On the task-transition/re-baseline path, read PS-1's persisted file (if any, and if it matches the session/task now being resumed) and take the **higher** of the two active/idle totals — the same `GREATEST`-style rule the backend already applies for `sync` in `TC-4`, just evaluated locally before the value is even sent:

```rust
let server_active = tracking.as_ref().map(|t| t.active_seconds).unwrap_or_else(|| session_seconds("activeSeconds"));
let server_idle = tracking.as_ref().map(|t| t.idle_seconds).unwrap_or_else(|| session_seconds("idleSeconds"));

let (local_active, local_idle) = progress_store
    .load()
    .filter(|p| p.session_id == session_id && p.task_id.as_deref() == Some(session_task_id.as_str()))
    .map(|p| (p.active_seconds, p.idle_seconds))
    .unwrap_or((0, 0));

state.active_baseline = server_active.max(local_active);
state.idle_baseline = server_idle.max(local_idle);
```

Scoped to the *same* `session_id`/`task_id` on purpose — a stale progress file from a different, already-closed session must never bleed into a new one. If the recovered local value wins, the very next `sync` (20s later, per `TC-4`'s clamp) is what actually lands the recovered seconds server-side — this task does not change the network path at all, only what the agent starts counting from.

**Acceptance**
- [ ] Killing the agent mid-session and relaunching resumes from the higher of (last local tick, last server sync), not just the server's
- [ ] A progress file from a *different* session/task is never used as a baseline
- [ ] A clean stop/sign-out (where `reset_task_progress` already cleared the file) restarts at the server's real number, unchanged from today
- [ ] The recovered seconds are visibly reflected in the next `sync` call

**Verify**
Reproduce PS-1's kill-mid-session scenario, relaunch the agent, and confirm the displayed total picks up from where it was at the moment of the kill (within one tick), not from the last 20s-old server sync.

**Depends on** — **PS-1**.

---

### PS-3 🟡 Reduce the loss window further where cheap to do so

**Problem**

Even with PS-1/PS-2, a crash mid-tick still loses at most one `SESSION_POLL_SEC` (5s) of local progress between the last disk write and the kill — small, and arguably fine to accept. This task is about not leaving an easy, cheap win on the table, not about closing that residual window to zero.

**Change** (pick what's actually worth it — this is the "nice to have" tier)
- Where the OS gives a graceful-shutdown signal (Windows session end / `WM_QUERYENDSESSION`, macOS app-termination notification), hook it to call the same flush `flush_and_stop_tracker` already does on a normal quit, so an OS-initiated shutdown behaves like a clean stop instead of an unclean kill.
- Nothing else here is worth building — the residual few-seconds window after PS-1/PS-2 is not a real product problem.

**Acceptance**
- [ ] A Windows shutdown/restart initiated by the OS flushes the session the same way `stop`/`sign-out` do today
- [ ] No regression to normal app quit/close-to-tray behavior

**Verify**
Trigger a Windows restart while a session is active; confirm the server shows a `stopped` session with the real accrued seconds, not an abandoned `active` one later closed by `TC-1`'s staleness sweep.

**Depends on** — **PS-1**.

---

## Notes for deciding scope

- **PS-1 + PS-2 are the actual fix.** They directly close the "app forgets its own truth on an unclean exit, server serves a stale number" case this plan exists for.
- **PS-3 is optional polish.** Worth doing only if it's cheap; skip it without regret if it isn't.
- This plan assumes `TC-4` (server-side clamp on downward writes) from `docs/TAURI-AGENT-IMPROVEMENTS.md` — confirmed already in place in the current code (`task-member-progress.service.js:96`, `activity-events-postgres.service.js:525`). PS-2 relies on that clamp existing so a recovered-but-wrong-high local value can't silently overwrite a correct lower server value on `sync` — the server has the final say either way.

---

# Phase 1 — Projects Page Refresh + Per-Project Idle Configuration

---

### RF-1 🟡 Refresh button on the Projects page toolbar

**Problem**

`ProjectsToolbar` (`Dashboard-Web/features/projects/components/projects-toolbar.tsx`) has no way to force-reload the list — a stale row (e.g. another admin just changed a budget) only clears on a full page reload. `ProjectsPage` already has a working `refetchProjects` from `useCachedList` (`projects-page.tsx:116-120`) that nothing in the toolbar calls.

**Files**
- `Dashboard-Web/features/projects/components/projects-toolbar.tsx` — new button
- `Dashboard-Web/features/projects/pages/projects-page.tsx` — pass `refetchProjects`/`isLoading` down

**Change**

Same icon/pattern already used on the Activity page (`activity-control-bar.tsx:159-161`, `RefreshCw` in an icon button) — for consistency, not a new pattern:

```tsx
<button
  type="button"
  onClick={() => void refetchProjects()}
  disabled={isLoading}
  className={/* same border/bg treatment as the existing Columns button, projects-toolbar.tsx:158-168 */}
  aria-label="Refresh projects"
>
  <RefreshCw className={cn("h-4 w-4", isLoading && "animate-spin")} />
  <span className="hidden sm:inline">Refresh</span>
</button>
```

Placed next to the "Columns" button in the toolbar's right-hand group.

**Acceptance**
- [ ] Clicking Refresh re-fetches the project list without a full page reload
- [ ] The icon spins while the fetch is in flight and stops on completion or error
- [ ] Button is present in both the Active and Archived tabs

**Verify** Change a project's name directly via the API (or a second browser tab), click Refresh in the first tab, confirm the new name appears without navigating away.

**Depends on** — nothing.

---

### ID-1 🔴 Per-project idle-time storage: schema, API, and the fields the modal needs

**Problem**

Today there is exactly one idle-time knob in the whole system, and it's global: `activity_scoring_settings` is a single `WHERE id = 1` row (`activity-scoring-postgres.service.js:1-16`) holding `idle_threshold_sec`/`idle_warn_sec`/`idle_alert_sec`/`idle_stop_sec` for the entire org, consumed by the agent via `fetch_activity_scoring_settings` → `ActivityTracker::apply_idle_thresholds` (`tracker.rs:286-303`).

Separately, `projects` already has a `disable_idle_time` boolean (`ensure-lookup-schema.js:739`, `schema.sql:485`) that round-trips through create/update/read (`Dashboard-Backend/src/modules/projects/routes.js:325-328, 547-548, 628-629`) and the modal's own toggle (`project-modal.tsx:925-934`) — but **nothing downstream ever reads it**. It is not passed to the agent in any form, and `tick_idle_escalation`/`tick_progress` have no concept of a per-project override at all. The switch visibly flips in the UI and saves to the database, and does exactly nothing to tracking behavior. That's the bug you flagged.

There is also no per-project *value* today — only the on/off switch. A minutes/hours idle-time input has nowhere to write to yet.

**Files**
- `Dashboard-Backend/src/lib/postgres/ensure-lookup-schema.js` — new column (idempotent `ADD COLUMN IF NOT EXISTS`, per this repo's own rule — see `docs/TAURI-AGENT-IMPROVEMENTS.md`'s "two project-specific rules")
- `Dashboard-Backend/src/lib/postgres/schema.sql` — mirror for documentation parity (not the applied path)
- `Dashboard-Backend/src/lib/postgres/projects-postgres.service.js` — read/write mapping (`:47-48`, `:73-74` pattern)
- `Dashboard-Backend/src/modules/projects/routes.js` — create/update/read payload (`:325-328`, `:547-548`, `:628-629` pattern)
- `Dashboard-Web/features/projects/api/project-api.ts`, `project-details-api.ts` — payload types (`disableIdleTime` already here, add the new field alongside)

**Change**

```sql
-- ensure-lookup-schema.js, alongside disable_idle_time
idle_time_seconds  INTEGER NOT NULL DEFAULT 450,   -- 450s = 7.5 minutes, the product default on creation
```

Named `_seconds`, not `_minutes`, matching the sibling columns this mirrors (`idle_threshold_sec`/`idle_warn_sec`/`idle_alert_sec`/`idle_stop_sec` on `activity_scoring_settings`) — and because the actual default, 7.5 minutes, is 450 seconds exactly but not a whole number of minutes, so an integer-minutes column can't represent it losslessly.

**This is a deliberate change from a "null = inherit org default" design** (which is what an earlier pass of this plan assumed) to **every project always having its own explicit value, defaulting to 450s at creation**. That's the point of asking for a per-creation default at all — a project's idle time is never a fallback to the org-wide row once this lands; it's its own number from the moment the project exists. The org-wide `activity_scoring_settings.idle_threshold_sec` still exists for other orgs/legacy reasons but ID-3 does not consult it for any project created after this migration.

**Backfill:** existing projects predate this column and need `idle_time_seconds` populated on migration, not left at whatever `DEFAULT 450` gives every row retroactively without a decision — flag whether that's actually the intended value for pre-existing projects or whether they should inherit their *current effective* org default at migration time (i.e. today's `activity_scoring_settings.idle_threshold_sec`) so behavior doesn't silently change for projects already running. Don't guess; the migration script should make this an explicit, reviewable choice, not an implicit side effect of `DEFAULT 450`.

**Semantics to settle before ID-2/ID-3 (flagging, not deciding silently):**
- `disable_idle_time = true` should mean **idle time is not tracked at all for this project** — no active/idle split, no warn/alert/auto-stop/rewind. This is the fix for "the switch does nothing."
- `idle_time_seconds` overrides `idle_threshold_sec` (the active-vs-idle boundary in `tick_progress`, `tracker.rs:724`) for sessions on this project. Whether it should *also* scale the warn/alert/stop escalation stages proportionally, or leave those on the org-wide timers, is a product call — ID-3 below assumes "just the threshold, escalation stays org-wide" as the simpler default. Say if that's wrong before ID-3 lands.

**Acceptance**
- [ ] `idle_time_seconds` persists per project, `NOT NULL`, defaults to `450` on creation, idempotent DDL
- [ ] Create/update/fetch-for-edit all round-trip both `disableIdleTime` and the idle-time value correctly
- [ ] A newly created project reports `450` without the creator having touched the field
- [ ] Migration backfill for pre-existing rows is an explicit, reviewed value — not a silent side effect of the column default

**Verify** Create a project without touching the idle-time field, confirm it saved as 7.5 minutes / 450s. Then edit it to 12 minutes, reopen, confirm `12`, not `7.5`, not blank.

**Depends on** — nothing.

---

### ID-2 🔴 General tab: idle-time hours/minutes input, gated on the (now-meaningful) disable switch

**Problem**

The General tab's "Disable idle time" toggle (`project-modal.tsx:925-934`) sits alone with no accompanying value — there's nothing to type a number into even after ID-1 adds somewhere to store one. The Budget tab already has the exact UX pattern needed: a toggle that reveals a dependent field via `ExpandCollapse` (`budgetStopTimers` → `budgetStopTimersAt`, `project-modal.tsx:1289-1319`), and a working hours+minutes split input (`decimalHoursToParts`/`partsToDecimalHours`/`formatHoursLabel`, `project-modal.tsx:169-197`, used for `budgetTotal`).

**Files**
- `Dashboard-Web/features/projects/components/modals/project-modal.tsx` — General tab section (`:899-935`), `AddProjectFormState`, `createDefaultAddForm`, `formStateToPayload`, the edit-load effect (`:491-526`)

**Change**

Reuse the existing hours/minutes split pattern's *shape* (`decimalHoursToParts`/`partsToDecimalHours`, `project-modal.tsx:169-197`), but note one real difference from `budgetTotal`: that helper pair is built around **decimal hours**, and every real idle-time value here is sub-hour (org defaults today are 1/5/10/15 minutes; the new creation default is 7.5 minutes) — so the minutes sub-field needs to actually carry the `.5`, which the Budget tab's integer `min={0} max={59}` minutes input (`:1144-1162`) does not need to. Add an equivalent decimal-minutes-aware pair (`decimalMinutesToParts`/`partsToDecimalMinutes`, same shape, minutes field allows a fractional step) rather than reusing the hours version as-is with a silent rounding bug on 7.5.

Add `idleTimeMinutes: string` (decimal minutes as a string, e.g. `"7.5"`) to `AddProjectFormState`, defaulted in `createDefaultAddForm` to `"7.5"` — **not blank** — so a brand-new project's form already shows the product default before the user touches anything, matching what ID-1 now persists server-side on creation:

```tsx
function createDefaultAddForm(): AddProjectFormState {
  return {
    // ...
    disableIdleTime: false,
    idleTimeMinutes: "7.5",   // matches ID-1's DB default (450s) — shown, not inferred
    // ...
  }
}
```

Gate the input the same way `budgetStopTimersAt` is gated — except inverted, since the field is meaningful when idle time is **not** disabled:

```tsx
<SettingToggleRow
  checked={addForm.disableIdleTime}
  onChange={(next) => setAddForm((p) => ({ ...p, disableIdleTime: next }))}
  label={<>Disable idle time<Info .../></>}
/>
<ExpandCollapse show={!addForm.disableIdleTime}>
  <FormField label="Idle time" hint="How long without activity before time is marked idle.">
    {/* hours + minutes pair, minutes accepting a fractional value, wired to addForm.idleTimeMinutes */}
  </FormField>
</ExpandCollapse>
```

Placed directly under the toggle inside the same `space-y-3 rounded-xl border` block (`:899`), not off in `AddProjectDynamicFields` — it's a fixed field like the other three toggles in that block, not a dynamic/config-driven one. In edit mode, load it from the project's real stored `idleTimeSeconds / 60`, same as every other field in the `fetchProjectForEdit` effect (`:491-526`) — the `"7.5"` literal is create-mode-only, never used to overwrite an existing project's saved value.

**Acceptance**
- [ ] A brand-new project's form shows "7.5" minutes pre-filled before any edit, matching ID-1's server-side default
- [ ] Toggling "Disable idle time" on collapses/hides the idle-time input; off reveals it
- [ ] The minutes sub-field correctly represents and round-trips a `.5` value (7.5 does not silently become 7 or 8)
- [ ] Edit mode pre-fills both the toggle and the value from the saved project's actual stored seconds — never the create-mode default

**Depends on** — **ID-1**.

---

### ID-3 🔴 Agent: honor the per-project idle setting instead of only the org-wide one

**Problem**

Even after ID-1/ID-2, nothing changes on the agent unless it actually fetches and applies the new fields. Today `tick_idle_escalation` and `tick_progress` only ever read the org-wide `idle_threshold_sec`/`idle_warn_sec`/`idle_alert_sec`/`idle_stop_sec` atomics (`tracker.rs:56-59`), which are seeded once from **compile-time constants** at construction (`IDLE_THRESHOLD_SEC = 60`, `IDLE_FLAG_WARN_SEC = 300`, `IDLE_FLAG_ALERT_SEC = 600`, `IDLE_FLAG_STOP_SEC = 900`, `constants.rs:75-86`, wired in at `tracker.rs:172-175`) and only ever overridden by one org-wide poll (`apply_idle_thresholds`, ACT-3). There is no per-session, per-project override path at all — this is the "don't have it hardcoded in the agent" gap: today the effective idle threshold for every project on an org is the same one number, sourced from a single settings row, not fetched per project.

**What "fetched, not hardcoded" means concretely after this task:** the compile-time constants remain only as the safety default `ActivityTracker::new` starts with before its first successful network call — every real tick after a session/task is known uses a value that came over the wire for *that specific project*, never the constant. Same shape as how `active_baseline`/`idle_baseline` already work — a local literal only as the pre-first-fetch bootstrap, never the steady-state source of truth.

**Files**
- `Dashboard-Backend/src/modules/tasks/task-time-tracking.js` — attach the owning project's idle fields to the response `normalizeTracking` already builds (`:42-59`), the same response `fetch_task_time_tracking` reads (task-anchored sessions)
- `Dashboard-Backend/src/modules/activity/routes.js` — the calling-project path (`GET /api/activity/session`, `:232`) needs the same two fields for task-less sessions, since ID-1's storage lives on `projects`, not `task_member_progress`
- `Tauri-App-Extension/src-tauri/src/types.rs` — extend `TaskTimeTracking` (`:177-187`) with `disable_idle_time: bool` and `idle_time_minutes: Option<u64>`
- `Tauri-App-Extension/src-tauri/src/agent/tracker.rs` — `TickState`, the task/project re-baseline block (`:450-475`), `tick_progress` (`:711-734`), `tick_idle_escalation` (`:593-688`)

**Change**

Thread two new fields through `TickState` (mirroring how `active_baseline`/`idle_baseline` already get set on the re-baseline block at `:450-475`, since that's the same moment the task/project is known):

```rust
struct TickState {
    // ...existing fields...
    idle_time_disabled: bool,       // this session's project has disable_idle_time = true
    idle_threshold_sec_for_project: u64,  // this project's idle_time_seconds — always present per ID-1, no Option needed
}
```

In `tick_progress` (`:711-734`), replace the flat `self.idle_threshold_sec.load(...)` read with `state.idle_threshold_sec_for_project`, and skip the idle branch entirely (always credit active) when `idle_time_disabled`:

```rust
if state.idle_time_disabled {
    *active_elapsed += delta;
} else if self.activity.idle_seconds() >= state.idle_threshold_sec_for_project {
    *idle_elapsed += delta;
} else {
    *active_elapsed += delta;
}
```

The org-wide `self.idle_threshold_sec` atomic (ACT-3) stops being read by `tick_progress` once this lands — every project always has its own value per ID-1, so there's nothing left to fall back to at this call site.

In `tick_idle_escalation` (`:593-688`), return `false` immediately (no warn/alert/auto-stop/rewind) when `idle_time_disabled` — this is what makes the switch *actually disable idle time* end to end, matching what "Disable idle time" has always claimed to do in the UI.

Per the open question in ID-1: this task assumes the override only replaces `idle_threshold_sec` (active/idle classification), and the warn/alert/stop escalation stages stay on the org-wide timers when idle time isn't disabled outright. If that's wrong, `idle_warn_sec`/`idle_alert_sec`/`idle_stop_sec` would need the same per-project override treatment — larger surface, flag before starting.

**Acceptance**
- [ ] A project with `disable_idle_time = true`: no idle time is ever credited, and idle escalation (warn/alert/auto-stop/rewind) never fires, for any session on that project
- [ ] A project with `idle_time_seconds` set to (say) 3 minutes marks a gap of that length as idle, independent of what any other project on the same org is configured with
- [ ] Two different tasks belonging to two different projects, tracked back to back in the same agent process, apply two different idle thresholds without a restart — proves the value is fetched per session, not read once at startup
- [ ] A calling (task-less) project session picks up its own project's settings, not just task-anchored ones
- [ ] Switching tasks mid-session (already re-baselines per `:450-475`) picks up the new task's project settings, not the previous task's — this is what makes idle time "specific to each task" in practice: a task never has its own idle setting directly, it always resolves through the one project it belongs to
- [ ] `constants.rs`'s `IDLE_THRESHOLD_SEC`/`IDLE_FLAG_*` values are provably only the pre-first-fetch bootstrap — nothing in steady-state tracking reads them once a project's real value has arrived

**Verify**
1. Reproduce first: on current code, flip "Disable idle time" on for a project, track time on it while genuinely idle past the org's `idle_stop_sec`, confirm the timer still auto-stops and rewinds today — the switch is provably inert.
2. After: same scenario, confirm the timer keeps running through the idle stretch with everything credited as active, and no idle-escalation status message ever appears for that session.
3. Set one project's idle time well below another project's, track a task on each in sequence within the same running agent, confirm the active/idle split uses the correct project's threshold each time.

**Depends on** — **ID-1**, **ID-2** (needs a real value in the database to fetch and apply).

---

## Notes for deciding scope (Phase 1)

- **ID-1 → ID-2 → ID-3 is the actual fix**, same shape as Phase 0's PS-1 → PS-2: storage first, then the surface to set it, then the consumer that makes it matter. Landing ID-1/ID-2 without ID-3 reproduces exactly today's bug (a switch and a field that save correctly and change nothing) — don't ship the UI ahead of the agent change.
- **RF-1 is unrelated and independent** — pure UI convenience, no schema/agent changes, safe to do first or in parallel with anything else here.
- **7.5 minutes (450s) is now a settled default**, not an open question — every project gets it at creation, and it's a real per-project value from that point on, not a stand-in for an org-wide fallback. The one thing still open is the pre-existing-project **backfill value** (ID-1) — that's a data-migration decision, separate from what new projects get.
- **The escalation-stage question in ID-1/ID-3 needs an answer before ID-3 starts**, not after — it changes which fields ID-1 needs to store and how many places ID-3 touches.
- **End state, once all of ID-1/ID-2/ID-3 land:** idle time is a property of the project, set explicitly at creation (defaulting to 7.5 minutes), editable per project, and every task's session resolves it through the one project that task belongs to — which is what makes it correct to describe as "specific to each project or each task" in the same breath. There is no third, separate per-task override in this plan; if that turns out to be wanted later (e.g. two tasks under one project needing different idle tolerances), it's a new column on `tasks`, not a reinterpretation of this work.
