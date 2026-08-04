# Desktop Agent — Implementation Plan

Scope: the Tauri desktop agent (`Tauri-App-Extension/`) plus the parts of `Dashboard-Backend` and `Dashboard-Web` that consume its data.

This document is an **execution plan**, not a survey. Every item below is a work order with named files, a concrete change, and acceptance criteria you can check off. The reasoning behind the non-obvious ones lives in the appendices so the task specs stay short.

**Deliberately excluded: estimates, dev-days, calendars, and sequencing by date.** Ordering here is by *dependency and risk* only. Schedule it when the plan is agreed.

---

## How to use this document

**Task IDs** are stable — reference them in branches, commits, and PRs (`TC-1`, `CF-3`, …). Never renumber; retire an ID rather than reuse it.

**Tiers:**
- 🔴 **Blocker** — broken, unsafe, or a hard prerequisite.
- 🟠 **High-value** — the change that most moves trust/accuracy.
- 🟡 **Incremental** — worthwhile once the above land.

**Every task carries:**

| Field | Meaning |
| :--- | :--- |
| **Problem** | What is wrong today, with file:line evidence |
| **Files** | Exact paths to touch |
| **Change** | The concrete edit, with code where it's short enough to specify |
| **Acceptance** | Checkboxes that are objectively true or false — no "improved" or "better" |
| **Verify** | How a human/CI confirms it, including the failure it must reproduce first |
| **Depends on** | Task IDs that must land first |

**Two project-specific rules that apply to every task in this plan:**

1. **Postgres schema changes go in `Dashboard-Backend/src/lib/postgres/ensure-lookup-schema.js`, not `schema.sql`.** That file runs on every boot and is the real source of truth; the deployment workflow has no manual migration step. Every DDL statement must therefore be idempotent (`CREATE TABLE IF NOT EXISTS`, `CREATE INDEX IF NOT EXISTS`, `ADD COLUMN IF NOT EXISTS`). A change that only exists in `schema.sql` will not be applied.
2. **Postgres is the system of record.** New or migrated storage goes to Postgres, not Firestore and not Redis. Redis is a cache/transport layer only — see **TC-1** and **Appendix B** for why this is load-bearing rather than stylistic.

**Definition of done for any task:** acceptance boxes ticked, verification run, and — for anything touching recorded seconds — a test that **fails before the change and passes after**. On this codebase that bar is already set by `tracker.rs`'s `rewind_active` tests; match it.

---

## Dependency map

```
PHASE 0 — TIMER CORRECTNESS  (independent; blocks nothing, blocked by nothing)
  TC-1 ──┐
  TC-2 ──┼── TC-4 ── TC-5 ── TC-6            TC-7 (standalone)
  TC-3 ──┘

PHASE 1 — COMPLIANCE FOUNDATION  (gates every new capture capability)
  CF-1 ── CF-2 ── CF-3 ── CF-4 ── CF-5 ── CF-6
    │
    └────────────────────────────────┐
PHASE 2 — macOS                      │   PHASE 3 — ACCURACY & ANTI-CHEAT
  MAC-1 (independent)                │     ACT-1 ─┬─ ACT-2 ── ACT-3
  MAC-2 ── MAC-3 ── MAC-4            │            └─ AC-1 ─┬─ AC-4
       └─────────────┐               │                     │
                     └── ACT-1       │     CLS-1 ── CLS-2 ─┴─ AC-2
                                     │     AC-3 (independent)
PHASE 4 — CLASSIFICATION             │
  CLS-1 ── CLS-2 ── CLS-3            │   PHASE 5 — URL COVERAGE
                                     │     URL-1 ── URL-2 ── URL-3
PHASE 6 — DISTRIBUTION               │   PHASE 7 — OBSERVABILITY & CLEANUP
  Store Path B (recommended first):  │     OBS-1  OBS-2  OBS-3
    DIST-1 ── DIST-8   (needs CF-2)  │     CQ-1..CQ-5
  Store Path A (MSIX, later):        │
    DIST-4 ─┐                        │
    DIST-5 ─┼── DIST-3 ── DIST-6     │
    DIST-7 ─┘                        │
  macOS:  DIST-2 (needs MAC-1,2,4)   │
```

**Hard ordering constraints, stated once:**
- **TC-2 must land before TC-3.** TC-3 alone makes the symptom invisible while leaving hours short — it hides a money bug behind a correct-looking display. See Appendix A.
- **Phase 1 (CF-*) gates every *new* capture capability** in Phases 3–5. It does not gate Phase 0, which fixes existing code.
- **ACT-1 (input hooks) unlocks AC-1 (injection detection) for free** — do not build AC-1 separately.
- **CLS-1 must land before AC-2** — the screenshot/activity correlation needs the category map.
- **MAC-3 unlocks the already-written macOS URL script**, which is dead code until then.

---

# Phase 0 — Timer Correctness

> **Why this phase is first, ahead of compliance.** Everything else in this plan is a new capability. This phase is defects in code already running on customers' machines, already producing the numbers customers are invoiced against. Shipping compliance controls on top of a timer that under-counts every hour means carefully documenting, consenting to, and lawfully retaining data that is wrong.
>
> Full root-cause analysis: **Appendix A**.

---

### TC-1 🔴 Make session-abandonment detection fail-open

**Problem**

`isAgentOnline` (`Dashboard-Backend/src/modules/activity/agent-heartbeat.js:23-31`) returns `false` for three different situations that are not the same situation:

```js
export async function isAgentOnline(memberId) {
  const redis = getRedisClient();
  if (!redis || !memberId) return false;      // Redis NOT CONFIGURED -> "offline"
  try {
    return (await redis.exists(key(memberId))) === 1;
  } catch {
    return false;                              // Redis UNREACHABLE  -> "offline"
  }
}
```

Only the third — key genuinely absent — means "the agent is gone". The other two mean "we don't know". `isSessionAbandoned` (`:39-44`) treats all three identically, and `findOpenSession` (`routes.js:143-151`) acts on it destructively by closing the session.

Blast radius: the agent polls `GET /api/activity/session` every 5s, so a Redis blip (`maxRetriesPerRequest: 2`, `lib/redis/client.js:24`) closes **every active session, for every tracked employee, within five seconds**. The agent then receives `null`, hits `tracker.rs:212-221`, calls `reset_task_progress`, and the UI clock resets to zero. `scheduleAbandonedSessionSweep` (every 30s) does the same globally, so idle members don't escape either. `REDIS_URL` merely being unset makes the agent timer permanently unusable with no error surfaced anywhere.

**Files**
- `Dashboard-Backend/src/modules/activity/agent-heartbeat.js` — replace the liveness source
- `Dashboard-Backend/test/` — new test file

**Change**

Stop asking Redis a question Postgres already answers. `activity_sessions.updated_at` is bumped on every sync (`updatePgSession`, called from `routes.js:491-498`), which the agent performs every 20s. It is durable, needs no second store, and cannot report "offline" because a cache restarted. It is already in `SESSION_COLUMNS` (`activity-events-postgres.service.js:303`) and already selected by both `findOpenPgSession` and `fetchAllOpenPgSessions`, so no query changes are needed.

```js
/** A session is abandoned only when the row itself has gone stale. No Redis in
 *  the correctness path — Redis stays for presence UI, where a false "offline"
 *  is cosmetic instead of destructive. */
const SESSION_STALE_MS = 90_000;   // ~4 missed 20s syncs — generous on purpose

export async function isSessionAbandoned(session) {
  if (!session) return false;
  const status = String(session.status || "").toLowerCase();
  if (session.source !== "agent" || (status !== "active" && status !== "idle")) return false;
  const updatedAt = new Date(session.updated_at ?? 0).getTime();
  return Number.isFinite(updatedAt) && Date.now() - updatedAt > SESSION_STALE_MS;
}
```

This deletes the Redis import from the abandonment path — a net code reduction.

If the heartbeat is retained for other consumers, `isAgentOnline` must additionally distinguish unknown from offline (return `null` for "can't tell") and every caller must treat `null` as "change nothing". **An unavailable cache must never be evidence that an employee stopped working.**

**Acceptance**
- [x] With `REDIS_URL` unset, an agent session that synced 2s ago survives `findOpenSession`
- [x] With Redis reachable but the heartbeat key absent, the same session still survives
- [x] A session whose `updated_at` is older than `SESSION_STALE_MS` is still closed, with `active_seconds` preserved
- [x] Web-source sessions (`source !== "agent"`) are never closed by this path, unchanged from today
- [x] `agent-heartbeat.js` no longer imports `getRedisClient` for the abandonment decision

**Verify**
1. Reproduce first: with the current code and `REDIS_URL` unset, start an agent timer and confirm it dies within ~5s. This must fail before the fix.
2. Restart the Redis container while several agents are tracking; every session survives.
3. Kill an agent process without a clean stop; its session is closed within `SESSION_STALE_MS + 30s` (sweep interval) with its synced seconds intact.

**Depends on** — nothing. Do this first; it is the largest active blast radius in the codebase.

---

### TC-2 🔴 Credit measured wall time, not an assumed poll interval

**Problem**

`ActivityTracker::loop_run` (`tracker.rs:137-157`) is `tick(); sleep(SESSION_POLL_SEC)`, and `tick_progress` (`tracker.rs:435-453`) credits a **fixed** 5 seconds per iteration:

```rust
if self.activity.idle_seconds() >= IDLE_THRESHOLD_SEC {
    *idle_elapsed += SESSION_POLL_SEC;      // assumes the tick took exactly 5s
} else {
    *active_elapsed += SESSION_POLL_SEC;
}
```

But an iteration is `5s + however long tick() took`, and `tick()` does network I/O every time:

| Work inside one `tick()` | Frequency | Timeout budget |
| :--- | :--- | :--- |
| `fetch_session()` — live `GET /api/activity/session` | **every tick** | `HTTP_TIMEOUT_SEC = 15` |
| `upload_app_slice()` — 1–2 `POST /events` | every `APP_LOG_INTERVAL_SEC = 15s` | `EVENT_POST_TIMEOUT_SEC = 30` |
| `upload_screenshot()` — capture + encode + POST | every 90–210s | `EVENT_POST_TIMEOUT_SEC = 30` |
| `post_session_action("sync")` | every `SESSION_SYNC_INTERVAL_SEC = 20s` | `HTTP_TIMEOUT_SEC = 15` |
| `maybe_flush_queue()` — offline backlog replay | every 30s | per-event |

The error is **one-directional**: the clock can only run slow. At 150ms average round trip that is ~3%; over a 45-minute session (~540 ticks) ≈ 81 seconds lost, which matches the drift measured in the reported screenshots (Appendix A). One request hitting its 15s timeout burns 15s of the employee's day and credits 5.

Every recorded hour in the system is short by an amount proportional to the user's network latency. Invoices, payroll, budget burn-down, and the `stop_timers_when_reached` gate (`routes.js:385-411`) all read that number.

**Files**
- `Tauri-App-Extension/src-tauri/src/agent/tracker.rs` — `tick_progress`, `tick`, `loop_run` signatures

**Change**

Extract the credit calculation into a free function so it is testable without a live session (matching the existing `rewind_active` pattern at `tracker.rs:487-490`), and thread a `last_tick_at: Instant` through the loop:

```rust
/// Seconds to credit for one tick. Real elapsed time, clamped.
///
/// The clamp is the deliberate ceiling: sleep/hibernate makes `duration_since`
/// return hours, and that must never be banked as active work. A resumed
/// laptop credits at most this, then idle escalation stops the session and
/// rewinds to the last real input — which is the correct outcome.
fn credited_seconds(elapsed: Duration) -> u64 {
    elapsed.as_secs().min(SESSION_POLL_SEC * 4)
}

fn tick_progress(
    &self,
    task_id: &str,
    last_tick_at: &mut Instant,          // new
    active_baseline: &u64,
    active_elapsed: &mut u64,
    idle_baseline: &u64,
    idle_elapsed: &mut u64,
) {
    let now = Instant::now();
    let delta = Self::credited_seconds(now.duration_since(*last_tick_at));
    *last_tick_at = now;

    if self.activity.idle_seconds() >= IDLE_THRESHOLD_SEC {
        *idle_elapsed += delta;
    } else {
        *active_elapsed += delta;
    }
    self.set_task_progress(
        task_id,
        *active_baseline + *active_elapsed,
        *idle_baseline + *idle_elapsed,
    );
}
```

Use `Instant`, never `SystemTime` — `Instant` is monotonic on both Windows and macOS, so this is immune to NTP steps, timezone changes, and a user setting the system clock.

Note `tick_progress` has **two** call sites (`tracker.rs:198` on the backend-unreachable path and `:297` on the normal path). Both must pass the same `last_tick_at`, and `reset_task_progress` must reset it to `Instant::now()` so a resumed session does not credit the gap since the last stop.

**Acceptance**
- [x] A tick taking 9s wall-clock credits 9s, not 5s
- [x] A 2-hour suspend gap credits at most `SESSION_POLL_SEC * 4`
- [x] `reset_task_progress` resets `last_tick_at`; a stop/resume cycle credits nothing for the gap
- [x] The backend-unreachable path (`tracker.rs:188-210`) credits real elapsed time too, not 5s
- [x] Unit tests exist for `credited_seconds` and fail against the old fixed-interval logic

**Verify**
1. Reproduce first: run a 30-minute session against a throttled connection (200ms+ added latency) and confirm the recorded `active_seconds` is materially short of 1800. This must fail before the fix.
2. After: same run lands within a few seconds of wall-clock.
3. Suspend/resume test: close the laptop mid-session for 10 minutes, reopen; confirm at most 20s was credited and idle escalation then behaves normally.

**Depends on** — nothing.

---

### TC-3 🔴 Make the agent's displayed clock monotonic while tracking

**Problem**

`liveActiveSeconds` (`Tauri-App-Extension/src/App.tsx:788`) is a 1Hz local ticker reseeded from the server with no floor:

```tsx
// App.tsx:1031-1033
useEffect(() => {
  setLiveActiveSeconds(session?.activeSeconds ?? 0);   // unconditional overwrite
}, [session?.activeSeconds]);
```

`session` is refetched every 5s (`App.tsx:953`), but the server's `activeSeconds` only moves every 20s (`SESSION_SYNC_INTERVAL_SEC`). Four polls in five therefore read a value the local ticker has already passed, and the effect snaps the display **backward**. TC-2's drift is what turns this from an unnoticed ≤20s sawtooth into the multi-minute drop that was reported.

**The same codebase already solves this — in the web dashboard, not the agent.** `Dashboard-Web/features/activity/utils/timer-task-storage.ts:160` states the invariant outright:

> "Backend is source of truth when idle; while timer runs, never drop below local counters."

implemented as `preferLocalIfHigher` and applied at `activity-tracking-context.tsx:218-224` and `:244-252`. The Tauri agent UI is the one timer surface in the product that never got it.

**Files**
- `Tauri-App-Extension/src/App.tsx` — the resync effect at `:1031-1033`

**Change**

```tsx
// Same rule as Dashboard-Web's applyBackendTaskTimerState({ preferLocalIfHigher }):
// backend wins when the timer is stopped; while it runs, never drop below local.
useEffect(() => {
  const next = session?.activeSeconds ?? 0;
  setLiveActiveSeconds((s) => (tracking ? Math.max(s, next) : next));
}, [session?.activeSeconds, tracking]);
```

While `tracking` is true the clock is monotonic. When it flips false (stopped, task switched, session gone) the guard drops and the server value is taken verbatim, so a genuine reset shows the true number rather than sticking at a stale high-water mark.

**Acceptance**
- [x] During an active session the displayed clock never decreases, across at least 30 minutes
- [x] Stopping the timer, then starting a new task, displays the new task's real number (not the previous high-water mark)
- [x] An idle-escalation auto-stop displays the rewound (lower) value once `tracking` is false
- [x] Comment references the Dashboard-Web invariant so the two stay recognisably the same rule

**Verify**
Run the 30-minute throttled session from TC-2 and watch the widget; combined with TC-2 the clock is both monotonic *and* accurate. Confirm the idle-stop case explicitly — that is the one legitimate decrease and it must still be visible.

**Depends on** — **TC-2** (mandatory ordering; shipping TC-3 alone hides TC-2's money bug behind a correct-looking display).

---

### TC-4 🟠 Clamp downward writes to recorded seconds — per action, not globally

**Problem**

Both counter stores take whatever `activeSeconds` arrives and write it straight in:

```sql
-- upsertTrackingRowPg, task-member-progress.service.js:89-97
ON CONFLICT (task_id, member_id) DO UPDATE SET
  active_seconds = EXCLUDED.active_seconds,     -- no floor
  idle_seconds   = EXCLUDED.idle_seconds,
```

and `routes.js:491-498` does the same for `activity_sessions`. Any request carrying a lower number silently destroys recorded time. Realistic sources: two devices tracking one task (each holds its own baseline from `fetch_task_time_tracking` and will stomp the other), a slow POST landing after a later one, or web and agent syncing the same task.

**The trap:** a naive `GREATEST(active_seconds, EXCLUDED.active_seconds)` would break the idle-escalation rewind (`tracker.rs:389-417`), which *must* write a lower value — that rewind is the entire anti-fraud mechanism of AC-1/AC-4. Clamping unconditionally would silently disable it.

**Files**
- `Dashboard-Backend/src/lib/postgres/task-member-progress.service.js` — `upsertTrackingRowPg`
- `Dashboard-Backend/src/modules/activity/routes.js` — the `sync`/`idle`/`resume` branches
- `Dashboard-Backend/src/modules/tasks/task-time-tracking.js` — pass the action through
- `Dashboard-Backend/test/` — new tests

**Change**

Make the clamp conditional on the action, and log every accepted decrease with its reason:

```js
// Monotonic on the routine path; explicit lowering only where intended.
const allowDecrease = action === "stop";
```

Thread `allowDecrease` into `upsertTrackingRowPg` so it emits `GREATEST(task_member_progress.active_seconds, EXCLUDED.active_seconds)` for `sync`/`start`/`resume`/`idle`, and a plain assignment for `stop`. Same treatment for the session update in `routes.js`.

A downward write on the money path must never be silent — the log line doubles as the integrity signal OBS-2 counts.

**Acceptance**
- [x] A `sync` carrying a lower `activeSeconds` than stored leaves the stored value unchanged
- [x] A `stop` carrying a lower value (idle rewind) **does** lower it — the rewind still works end to end
- [x] Every accepted decrease emits a log line with member, task, old value, new value, and action
- [x] Two concurrent syncs with different baselines converge on the higher value
- [x] Test covers both directions; the rewind test fails if the clamp is made unconditional

**Verify**
Run the existing idle-escalation flow to completion and confirm the reversed seconds are still reversed. That is the regression this task is most likely to cause.

**Depends on** — nothing strictly, but sequence after **TC-1** so session lifetime is stable while testing.

---

### TC-5 🟠 Make the sync-time cap actually fire

**Problem**

`enforceTimerAllowanceOnSync` (`timer-limit.service.js:232-254`) looks like it clamps an overrunning timer. It cannot:

```js
const allowance = await computeTimerAllowance(db, memberId, task, {
  currentCumulativeActiveSeconds: activeSeconds,          // same value
});
// buildAllowanceResult: maxCumulativeActiveSeconds = currentCumulativeActiveSeconds + allowedRemainingSeconds
if (activeSeconds > allowance.maxCumulativeActiveSeconds) { /* unreachable */ }
```

`maxCumulativeActiveSeconds` is *derived from* `activeSeconds`, so the condition reduces to `0 > allowedRemainingSeconds` — and every remainder is built with `Math.max(0, …)` (`:158-172`), so it is never negative. **`capped` is always `false`; `timerCapped` in the API response is always `false`.**

Net effect: daily/weekly/task caps are enforced only at `start`/`resume`. A session beginning under the cap runs past it indefinitely — start at 7h55m against an 8h cap and nothing stops you at 8h. The project budget gate (`routes.js:385-411`) has the same shape and the same hole.

**Files**
- `Dashboard-Backend/src/modules/tasks/timer-limit.service.js` — `enforceTimerAllowanceOnSync`
- `Dashboard-Backend/src/modules/activity/routes.js` — act on the result
- `Tauri-App-Extension/src-tauri/src/agent/` — handle a capped response
- `Dashboard-Backend/test/timer-allowance.test.js` — extend

**Change**

Ask for the absolute ceiling instead of one derived from the input:

```js
const allowance = await computeTimerAllowance(db, memberId, task, {
  currentCumulativeActiveSeconds: 0,   // absolute ceiling, independent of input
});
const ceiling = allowance.maxCumulativeActiveSeconds;
if (ceiling != null && activeSeconds > ceiling) {
  return { activeSeconds: ceiling, capped: true, allowance };
}
```

Then **have the session route act on `timerCapped`**: return it to the agent and let the agent stop the timer. Silently truncating the number while the clock keeps running would reintroduce a backward jump, server-side this time — do not do that.

Extend the same mid-session evaluation to the project budget gate so `stop_timers_when_reached` can't be crossed by a session that started under it.

**Acceptance**
- [x] A sync above the member's daily cap returns `capped: true` (this assertion fails today)
- [x] The agent receives the capped signal and stops the timer, showing a clear reason
- [x] The displayed clock does not jump backward when a cap is hit — it stops
- [x] A session that starts under a project budget threshold and crosses it mid-session is stopped
- [x] Test asserts `capped === true` for an over-cap sync; it must fail against current code

**Depends on** — **TC-4** (both touch how a lower authoritative value reaches the client; land the clamp first so "capped" is the only legitimate decrease on the sync path).

---

### TC-6 🟠 Retry a failed idle-stop instead of silently resuming

**Problem**

In `tick_idle_escalation` the stop is fire-and-forget (`tracker.rs:405-411`):

```rust
let _ = self.api.lock().post_session_action("stop", /* … */ rewound, idle_total);
```

If that request fails — and network problems often *accompany* an idle stretch — the agent clears its local session and returns `true`, but the server still has the session `active`. On the next tick `fetch_session()` returns it; `task_id` is empty after `reset_task_progress`, so the re-baseline branch (`tracker.rs:267-292`) fires and **tracking silently resumes with the rewind never applied**. The idle time just reversed is re-credited. Meanwhile the agent's own 5s `GET` keeps the session looking alive, so nothing else closes it either.

**Files**
- `Tauri-App-Extension/src-tauri/src/agent/tracker.rs` — `ActivityTracker` state + `tick` + `tick_idle_escalation`

**Change**

Treat the stop as pending until acknowledged. Add `pending_stop: Arc<Mutex<Option<(u64, u64)>>>` to the tracker; on a failed stop POST, store `(rewound, idle_total)`, and at the top of `tick` retry it and return early while it is `Some`. Refuse to re-enter tracking while a stop is outstanding.

The offline queue (`queue.rs`) already exists for "must eventually reach the server" semantics — reuse it if it fits cleanly, otherwise the `pending_stop` field is the smaller change.

**Acceptance**
- [x] With the network down at the moment of idle auto-stop, the agent does not resume tracking on subsequent ticks
- [x] When the network returns, the stop is delivered with the original rewound values (not recomputed)
- [x] No zombie `active` session remains server-side after the retry succeeds
- [x] The UI shows the stopped/idle state throughout, not "tracking"

**Verify**
Reproduce first: trigger idle escalation with the backend unreachable, restore the network, and confirm on current code that tracking silently resumed and the rewind was lost.

**Depends on** — nothing.

---

### TC-7 🟡 Guarantee one open session per member

**Problem**

`findOpenPgSession` (`activity-events-postgres.service.js:306-316`) is `ORDER BY started_at DESC LIMIT 1`. If a member ends up with two open sessions — two machines, or web plus agent — the older becomes invisible to every path here: never returned, never synced, never cleanly stopped. Its `active_seconds` sit in the table contributing to reports.

**Files**
- `Dashboard-Backend/src/lib/postgres/ensure-lookup-schema.js` — the index (**not** `schema.sql`)
- `Dashboard-Backend/src/modules/activity/routes.js` — the conflict response

**Change**

Idempotent partial unique index plus an explicit error instead of quietly opening a second session:

```sql
CREATE UNIQUE INDEX IF NOT EXISTS activity_sessions_one_open_per_member
  ON activity_sessions (member_id) WHERE ended_at IS NULL;
```

Before adding it, close or reconcile any existing duplicates — the index creation will fail against dirty data, and on this deployment that means a boot failure, not a migration error someone reads. Add the cleanup as a guarded one-time step in the same file.

Return a clear "you already have a timer running on another device" response rather than a constraint-violation stack trace.

**Acceptance**
- [x] Pre-existing duplicate open sessions are reconciled before the index is created
- [x] Index creation is idempotent and safe to run on every boot
- [x] Starting a second concurrent session returns a specific, actionable error
- [x] Existing single-session flows are unaffected

**Depends on** — **TC-1** (which changes what "open" means in practice); run the duplicate cleanup after abandonment is fail-open, or it will close sessions it shouldn't.

---

# Phase 1 — Compliance Foundation

Employee monitoring is lawful in essentially every market **when it is disclosed, proportionate, consented where required, and limited in purpose and retention.** It becomes unlawful when it is covert, excessive, or repurposed. The difference is entirely in the controls below, which is why they are built before the capabilities in Phases 3–5 rather than retrofitted after.

> **Not legal advice.** This is the *engineering scaffolding* for compliance — the toggles, disclosures, retention logic, and audit trails a lawful product needs, written by engineers. Have the design reviewed by qualified privacy/employment counsel and, for the EU, a DPO. The controls are designed to make that review pass, not to replace it. Jurisdiction detail is in **Appendix C**.

---

### CF-1 🔴 Per-org, per-capability consent & configuration registry

**Problem** — There is no server-side source of truth for what a given org is permitted to capture. Capability is decided by what the agent build happens to do.

**Files**
- `Dashboard-Backend/src/lib/postgres/ensure-lookup-schema.js` — new table
- `Dashboard-Backend/src/modules/` — new module for reads/writes + audit
- `Tauri-App-Extension/src-tauri/src/config/` — consume via the existing `Settings` delivery path

**Change**

```
monitoring_policy
  org_id
  capability            -- 'screenshots' | 'app_tracking' | 'url_capture' |
                        --   'activity_metering' | 'dns_logging' | 'integrity_signals' | ...
  enabled               -- default FALSE for every capability
  jurisdiction_profile  -- drives which capabilities are even offerable (CF-4)
  lawful_basis          -- 'legitimate_interest' | 'consent' | 'contract'
  disclosed_at          -- when the employee was shown the notice
  consented_at          -- when/if the employee acknowledged (nullable)
  enabled_by            -- admin member id (audit)
  enabled_at
```

Rules the code enforces:
- **Default deny.** No row, or `enabled = FALSE`, means never captured. The agent must receive an explicit allow, never assume one.
- **The server tells the agent what it may do**, not its build. Enabling/disabling monitoring becomes a policy change, never a re-release, and every device converges on the org's current lawful configuration on next sync.
- Every change writes an **immutable audit record** — this is the evidence of lawful processing if challenged.

**Acceptance**
- [x] A capability with no row is not captured by the agent
- [x] Flipping a capability off takes effect on connected agents within one settings-sync cycle, with no re-release
- [x] Every policy change writes an audit row naming actor, capability, lawful basis, and timestamp
- [x] Audit rows cannot be updated or deleted through the application
- [x] DDL is idempotent and lives in `ensure-lookup-schema.js`

---

### CF-2 🔴 Mandatory in-agent disclosure

**Problem** — Covert monitoring is unlawful almost everywhere (GDPR transparency duty, US ECPA and state notice laws, EU labour law). The agent currently has no disclosure surface.

**Files**
- `Tauri-App-Extension/src/` — first-run notice + persistent indicator
- `Tauri-App-Extension/src-tauri/src/` — read policy, gate tracking on acknowledgement

**Change**
- On first run, and whenever monitored capabilities change, show a **plain-language notice** stating exactly what is collected, why, how long it is kept, and who can see it — **sourced from the CF-1 row** so it is always accurate to what is actually enabled.
- A **persistent, non-hideable indicator** while tracking is active (tray state plus an obvious in-window affordance).
- The employee can always see **their own** collected data (supports CF-5).
- **No stealth mode, ever.** It is the fastest route to making the product unlawful and to failing Microsoft Store certification (DIST-1).

**Acceptance**
- [x] Notice text is generated from the CF-1 policy row, not hardcoded
- [x] Tracking cannot start before the notice has been shown and acknowledged
- [x] The tracking indicator cannot be hidden or disabled by any setting or flag
- [x] Changing an enabled capability re-triggers the notice
- [x] There is no build flag, env var, or config path that suppresses the indicator

**Depends on** — **CF-1**. **Blocks** — **DIST-1** (Store certification depends on this being real).

---

### CF-3 🔴 Data minimization & purpose limitation

**Files** — screenshot pipeline, `activity_url_logs` writers, activity metering

**Change**
- **Screenshots** — offer **blur/redaction** and **capture-off for flagged private apps** (banking, health, personal email) as first-class options. Screenshots are the highest-risk data because they can incidentally capture *special-category data* (health, union membership, religion), which is heavily restricted. Provide a per-app/domain **capture exclusion list** and make blur-by-default an available posture.
- **URLs** — offer a **domain-only mode** (store `github.com`, not a full path whose query string may carry personal data). Wire it to the `domain` column already present in `activity_url_logs`.
- **No keystroke *content* logging, at any tier.** ACT-1/ACT-2 count and characterise keystrokes for a score; they must never capture the characters typed. That is keylogging — a categorically higher legal risk and unnecessary for the metric.
- Purpose-lock the data to time/productivity/attendance integrity. Repurposing (disciplinary fishing, performance-firing evidence) must be a deliberate, logged act.

**Acceptance**
- [x] An app on the exclusion list produces no screenshot at all (not a blurred one)
- [x] Domain-only mode stores no path or query component anywhere
- [x] No code path records keystroke characters; a grep-able assertion or test enforces this
- [x] Blur-by-default is selectable per org

**Depends on** — **CF-1**.

---

### CF-4 🔴 Jurisdiction profiles

**Change** — Encode market constraints so an org in a restrictive jurisdiction is *physically prevented* from enabling a capability it may not use. A capability unavailable in a profile is not merely off — **it is not offerable**, and does not render as a toggle. Profile table and constraints: **Appendix C**.

**Acceptance**
- [x] `jurisdiction_profile` on the CF-1 row determines which capabilities render as toggles
- [x] An API call attempting to enable a capability disallowed by the profile is rejected server-side, not just hidden in the UI
- [x] The default for an unset profile is the strictest posture
- [x] URL-3 (network interception) is unavailable under the EU/UK profile

**Depends on** — **CF-1**.

---

### CF-5 🔴 Retention limits & data-subject rights

**Change**
- **Retention** — generalise the existing screenshot model (3-week hot / archive, already implemented as bytea on `activity_screenshots` with an auth-gated GET) into a configurable, enforced max-retention **per data type**, with automatic deletion. Indefinite retention of monitoring data fails GDPR storage limitation and most privacy regimes.
- **Right of access (DSAR)** — the schema is already keyed by `member_id`; build an export endpoint gathering a member's screenshots, app logs, URL logs, and sessions into one package.
- **Right to erasure / correction** — a supported path to delete or correct an individual's monitoring data on lawful request.
- **Access control & logging** — restrict who can view raw monitoring data (screenshots especially) and **log every access**. Over-broad internal access is itself a compliance failure.

**Acceptance**
- [x] Every monitoring data type has an enforced retention ceiling; nothing is retained indefinitely
- [x] A DSAR export returns all data for one member across all four stores in a single package
- [x] Erasure removes the data from hot storage and archive
- [x] Every read of a raw screenshot writes an access log entry naming the reader

**Depends on** — **CF-1**.

---

### CF-6 🟠 Company-device scoping & off-the-clock boundaries

**Change**
- Capture happens **only inside an explicitly started tracking session** — never silently in the background outside one. The agent is already session-scoped; make this an enforced invariant rather than an emergent property.
- On BYOD the legal bar is much higher: provide a clear "this is a personal device" path that either declines monitoring or applies a minimal, clearly-consented subset.

**Acceptance**
- [x] No capture of any kind occurs while no session is active — verified by inspecting the event stream over an idle hour with the agent running
- [x] A device marked personal cannot enable the full capability set
- [x] Device ownership (company/BYOD) is recorded and auditable

**Depends on** — **CF-1**.

---

# Phase 2 — macOS Enablement

The module boundaries are already platform-aware: every Win32 call is `#[cfg(windows)]`-gated with a `#[cfg(not(windows))]` companion, `icon.icns` exists, the macOS URL AppleScript is written and bundled, and `util.rs` has a working macOS browser-open branch. **It compiles and launches on macOS today** — it just does nothing useful, because three fallbacks are stubs.

---

### MAC-1 🔴 Encrypt tokens on macOS (currently plaintext on disk)

**Problem** — `src-tauri/src/auth/dpapi.rs:72-80` returns `None` on non-Windows, and `src-tauri/src/auth/tokens.rs:82` then does `dpapi::protect(&json).unwrap_or(json)` — silently writing the Firebase refresh token as plain JSON to disk.

**Change** — Implement `protect`/`unprotect` on macOS against the Keychain. The `keyring` crate (v3) covers Windows Credential Manager + macOS Keychain + Linux Secret Service behind one API, which also **retires the hand-rolled DPAPI code entirely** and unifies all three platforms — a net code reduction. Alternative if the token must stay in a file: wrap the bytes with `security-framework`'s `SecKeychain`.

**Acceptance**
- [x] No refresh token is written unencrypted on any platform
- [x] Windows behaviour is unchanged for existing installs (or migrates cleanly)
- [x] Hand-rolled DPAPI code is deleted, not left alongside
- [x] Must land before any macOS build ships

**Depends on** — nothing. Supersedes the separate "retire DPAPI" cleanup item.

---

### MAC-2 🔴 Real foreground-window detection on macOS

**Problem** — `src-tauri/src/capture/window.rs:70-79` returns `app_name: "Unknown"`, `title: "Unknown"`, `is_browser: false`.

**Change** — `NSWorkspace.frontmostApplication` gives app name and bundle id with no special permission. The window **title** needs `CGWindowListCopyWindowInfo`, which requires **Screen Recording** permission on macOS 10.15+. Set `is_browser` by matching the bundle id (`com.apple.Safari`, `com.google.Chrome`, …).

> **Knock-on:** because the stub hardcodes `is_browser: false` and `read_browser_url` bails at `window.rs:242` on `if !window.is_browser`, **the macOS URL AppleScript at `window.rs:290` is currently unreachable dead code.** This task is what switches it on — macOS URL capture is "MAC-2 plus a permission prompt", not new script work.

**Acceptance**
- [x] Real app name and window title on macOS
- [x] `is_browser` correct for Safari, Chrome, Edge, Firefox, Brave
- [x] The existing macOS URL script executes and returns a URL
- [x] Missing Screen Recording permission degrades gracefully with a clear prompt, not a crash or a silent "Unknown"

**Depends on** — nothing. **Blocks** — ACT-1's macOS half in practice (same permission surface).

---

### MAC-3 🟠 Cross-platform app-name mapping

**Problem** — `BROWSER_EXES` (`window.rs:42`) and the dashboard's `display-names.ts` map `chrome.exe → "Google Chrome"`. macOS reports `"Google Chrome"` directly, so Mac apps render unmapped on both sides. The two lists are also independent sources of truth that will drift.

**Change** — Fold both into the single server-delivered list introduced by **CLS-1** (same data, same table). Do not build a second mechanism.

**Acceptance**
- [x] macOS app names render correctly in the dashboard
- [x] Rust and frontend read one list, not two
- [x] Adding a browser requires no client release

**Depends on** — **CLS-1**, **MAC-2**.

---

### MAC-4 🟠 Signing, notarization, packaging

| Item | Where | Change |
| :--- | :--- | :--- |
| Bundle targets are `["nsis","msi"]` | `src-tauri/tauri.conf.json` | Add `["app","dmg"]` and a `bundle.macOS` block (minimumSystemVersion, entitlements) |
| No code signing / notarization | CI | Gatekeeper blocks unsigned apps. Requires Apple Developer ID + `notarytool` |
| Screen Recording TCC permission | new | Mandatory for `xcap` capture on 10.15+, else screenshots are blank. Add Info.plist usage strings, including `NSAppleEventsUsageDescription` for the URL AppleScript |
| Updater manifest | updater endpoint | `latest.json` needs `darwin-aarch64` / `darwin-x86_64` targets, or ship a universal binary |
| Download link hardcoded to `.exe` | `Dashboard-Web/features/activity/components/activity-tools-page.tsx:7` (`DOWNLOAD_URL`) | Serve the correct artifact per detected OS |

**Acceptance**
- [ ] A notarized DMG installs and runs on a clean Mac with no Gatekeeper warning
- [ ] Screenshots are non-blank after granting Screen Recording
- [ ] The updater successfully updates a macOS install
- [ ] The web download button serves the right artifact for the visitor's OS

**Depends on** — **MAC-1**, **MAC-2**. See **Appendix D** for why the Mac App Store is not a target.

---

# Phase 3 — Activity Accuracy & Anti-Cheat

The activity percentage is currently both **inaccurate** and **trivially faked**, and it is the headline metric managers look at.

**How it works today:** `ActivityMeter` (`src-tauri/src/capture/activity.rs`) polls every 100ms — `GetCursorPos` for any cursor movement, `GetAsyncKeyState` on **6 hardcoded keys** (`0x01,0x02,0x08,0x09,0x0D,0x20`) — sums into a 60s rolling window and divides by `ACTIVITY_SATURATION_EVENTS = 120`, with a 5% floor. On macOS the entire non-Windows branch is a comment (`activity.rs:70`), so every Mac user reads a flat 5% forever.

Four concrete problems: polling misses input between ticks and ignores every key outside the hardcoded six; nothing distinguishes real from synthetic input, so a jiggler pins the score to 100%; mouse movement and a keystroke count identically; macOS scores nothing.

> **Legal guardrail for every anti-cheat item below (GDPR Art. 22).** Integrity signals flag *suspected* fraud; they do not prove it. A person has the right not to be subject to a solely automated decision with significant effect (pay, discipline, dismissal). Every signal here is a **manager-reviewed flag with a human in the loop**, and the employee must have a route to see and contest it against their own data (CF-5). **Never wire an integrity signal directly to an adverse action.** Disclose in the CF-2 notice that anti-fraud signals are collected. Built this way the whole phase is lawful; wired to automatic punishment it is not.

---

### ACT-1 🔴 Replace polling with OS-level input hooks

**Change** — Swap the 100ms poller for hooks that fire on **every** event:
- **Windows** — `SetWindowsHookExW` with `WH_KEYBOARD_LL` and `WH_MOUSE_LL`. `KBDLLHOOKSTRUCT.flags` / `MSLLHOOKSTRUCT.flags` expose **`LLKHF_INJECTED`**, set by the OS when the event was synthetically generated (SendInput, auto-clickers, most jigglers, RDP/VM injection). **Capture this flag — it costs nothing extra and is the entire basis of AC-1.**
- **macOS** — `CGEventTap` at `kCGSessionEventTap` (requires Accessibility permission). `CGEventGetIntegerValueField(event, kCGEventSourceStateID)` distinguishes hardware from synthetic.

A hook-based meter is more accurate, cheaper than a busy-poll, fixes the macOS 5% floor, and yields the injection flag for free.

**Acceptance**
- [x] Fast typing is fully counted; no keys are excluded by a hardcoded list
- [x] macOS reports a real score, not `ACTIVITY_MIN_SCORE`
- [x] The injected/synthetic flag is captured per event on both platforms
- [x] Hooks are unregistered on stop/sign-out/quit — no leaked system-wide hooks (requires CQ-1)
- [x] CPU usage is no higher than the current poller

**Depends on** — **MAC-2** for the macOS half (shared permission surface). **Blocks** — **AC-1**.

---

### ACT-2 🟠 Score keystroke *work*, not keystroke *count*

**Change**
- Count **distinct keys** and keystroke **cadence variance**, not raw key-down count. 200 presses of one key, or perfectly even 100ms spacing, is a macro; varied keys at human-irregular timing is real work.
- Weight **keyboard > mouse-click > mouse-move**. They are currently equal.
- Consider **mouse-path entropy** — straight-line or looping paths indicate automation, jittery paths indicate a human.

**Acceptance**
- [x] A macro repeating one key scores materially lower than varied typing at the same rate
- [x] Mouse-only activity cannot reach the same score as sustained typing
- [x] Scoring logic is unit-tested against recorded input traces

**Depends on** — **ACT-1**.

---

### ACT-3 🟡 Server-tunable scoring constants

**Problem** — `ACTIVITY_SATURATION_EVENTS = 120` and the window length are hardcoded guesses baked into the binary; `constants.rs` also bakes screenshot cadence, idle thresholds, and retention. Every tuning change is a full rebuild-sign-notarize-ship cycle across two platforms.

**Change** — Move them to the server-delivered `Settings` struct the agent already receives, so orgs can calibrate without a release. A data-entry role and a designer have very different "100% looks like" baselines.

**Acceptance**
- [x] Saturation threshold, window length, screenshot cadence, and idle thresholds are all server-tunable per org
- [x] Agents pick up changes on the next settings sync, no restart
- [x] Sensible defaults apply when the server sends nothing

---

### ACT-4 🟡 Send richer per-capture signal to the backend

**Problem** — Only `activity_level` (one integer) reaches the server (`activity-events-postgres.service.js`), which is not enough to re-score or flag anything server-side.

**Change** — Also send per capture: `keystroke_count`, `distinct_keys`, `mouse_distance_px`, `injected_event_count`, `active_seconds_in_window`. Cheap additions to the `Screenshot`/`App` structs in `src-tauri/src/types.rs`; they let the **server** recompute or flag scores without a client update.

**Acceptance**
- [x] All five fields persist per capture
- [x] The server can recompute an activity score from stored fields alone
- [x] Adjusting scoring server-side requires no agent release

**Depends on** — **ACT-1**. **Blocks** — **AC-2**, **AC-4** (both need this signal).

---

### AC-1 🟠 Detect synthetic/injected input (kills software jigglers and auto-clickers)

**Change** — Falls out of ACT-1 for free. Count injected vs hardware events per window; a session that is "100% active" but ~100% injected is a near-certain fake.

**Statistical fallback for hardware jigglers** (USB dongles that physically wiggle a real mouse, which produce genuine hardware events): they generate **mechanically regular** motion — near-constant interval, repeating path, low entropy. Flag low cadence variance and low mouse-path entropy over a window. Humans are irregular.

Surface as a per-session **integrity flag**, never a hard block — false positives exist (presentation remotes, accessibility tools).

**Acceptance**
- [x] A software jiggler running against an idle machine is flagged
- [x] A hardware jiggler is flagged by the entropy fallback
- [x] Normal work over a long session produces no flag (false-positive check on real usage)
- [x] The flag is reviewable by a manager and contestable by the employee; it drives no automatic action

**Depends on** — **ACT-1**.

---

### AC-2 🟠 Correlate screenshots with claimed activity (kills background playback)

**Problem** — Screenshots and an activity number are both captured, but nothing checks them against each other. "High activity while a video or game is foreground for 40 minutes" is exactly the background-playback fraud pattern.

**Change** — Two server-side checks, no new agent capability:
- **Category conflict** — foreground app/domain is `distracting` (CLS-1) for a sustained span **while** activity reads high → flag.
- **Screenshot staleness** — near-identical consecutive screenshots (perceptual hash / diff) **while** activity reads high → the screen isn't changing but "input" is. Store a perceptual hash per screenshot and compare.

**Acceptance**
- [x] A session with a static screen and high reported activity is flagged
- [x] Sustained distracting-category foreground with high activity is flagged
- [x] Perceptual hash is stored per screenshot and the comparison is a backend job
- [x] Legitimate long reading/review sessions are not flagged (false-positive check)

**Depends on** — **CLS-1**, **ACT-4**.

---

### AC-3 🟡 VM / sandbox detection as a weighted flag

**Change** — Detect that the agent is running inside a VM, since a common dodge is "run the tracker in a throwaway VM with a jiggler while working elsewhere on the host".
- **Windows** — CPUID hypervisor-present bit; vendor string (`VMwareVMware`, `KVMKVMKVM`, `Microsoft Hv`, `VBoxVBoxVBox`); VM MAC OUI prefixes; VM registry/driver artifacts (`vmmouse`, `vboxguest`).
- **macOS** — `sysctl kern.hv_vmm_present`; virtual hardware model strings.

> **This one has real false positives, which is also legal exposure.** Plenty of legitimate remote workers run VMs, VDI, cloud dev boxes, or Parallels. VM-detected must be a **flag for review weighted by context**, never an automatic verdict or block — a false flag that auto-penalises a legitimate remote worker is both wrong and unlawful. It is also a permanent arms race (VM-hiding tools exist), so do not over-invest: AC-1 and AC-2 catch more real fraud for less effort and fewer false accusations.

**Acceptance**
- [x] Detection runs on both platforms and records a signal, not a verdict
- [x] No automatic action is taken on a VM flag anywhere in the codebase
- [x] Context weighting is applied before a manager sees it
- [x] Do this **last** of the anti-cheat set

---

### AC-4 🟡 Session-level integrity summary

**Change** — Roll AC-1..AC-3 into one **integrity score** per session, shown next to the activity % with its contributing flags (injected-input %, screenshot staleness, category-conflict minutes, VM-detected). This reframes the feature honestly: instead of one gameable "activity %", managers get "activity % **plus how much to trust it**".

**Acceptance**
- [x] Every session carries an integrity score with visible contributing factors
- [x] An employee can view and contest their own flags
- [x] No adverse action is triggered automatically at any score

**Depends on** — **AC-1**, **ACT-4**.

---

# Phase 4 — Classification & Focused Time

There is **no classification today** — the `apps` table (`ensure-lookup-schema.js`) stores only names, and `activity_url_logs` only `url`/`domain`. Greenfield but well-trodden.

---

### CLS-1 🟠 Category dimension for apps and domains

**Files** — `Dashboard-Backend/src/lib/postgres/ensure-lookup-schema.js`, plus override UI

**Change**

```
activity_categories
  app_or_domain   VARCHAR   -- "code.exe", "github.com", "youtube.com"
  match_type      VARCHAR   -- 'app' | 'domain'
  category        VARCHAR   -- 'productive' | 'neutral' | 'distracting' | 'unclassified'
  scope           VARCHAR   -- 'global_default' | org_id  (org overrides win)
  role_override   JSONB     -- optional per-role reclassification
```

Ship a **global default map** (IDEs/office/CRM = productive; Slack/email = neutral; streaming/games/social = distracting) and let each org override per app/domain and per role — a designer on Behance is productive, a data-entry clerk on Behance is distracting. This is the model ActivTrak and Time Doctor use, and it is the honest way to answer "useful vs useless" without hardcoding value judgements into the agent.

**This table also carries the app display-name mapping for MAC-3 and CQ-4** — one server-delivered list consumed by both Rust and the frontend. Do not create a second one.

**Acceptance**
- [x] Global defaults ship populated
- [x] Org overrides take precedence over global; role overrides over org
- [x] Rust and frontend both read display names from this table
- [x] DDL is idempotent, in `ensure-lookup-schema.js`

**Blocks** — **CLS-2**, **AC-2**, **MAC-3**, **CQ-4**.

---

### CLS-2 🟠 Focused-time metric

**Change** — Once apps/domains carry categories, show **productive / neutral / distracting minutes** instead of, or alongside, the raw activity %. Far more meaningful to a manager than "73% mouse-wiggle". Pure backend aggregation over `activity_app_logs` + `activity_url_logs` joined to the category table — no agent change.

**Acceptance**
- [x] Dashboard shows the three-way minute split per member per day
- [x] Numbers reconcile with total tracked time
- [x] No agent release required

**Depends on** — **CLS-1**.

---

### CLS-3 🟡 Auto-classification assist

**Change** — For frequently-seen unclassified apps/domains: surface a manager review queue ("categorise these 12 new apps your team used") and seed suggestions from a static bundled list. **Avoid a heavyweight ML classifier** — a curated list plus manager overrides beats it on accuracy and trust, and doesn't leak customers' browsing to a third-party model.

**Acceptance**
- [x] Unclassified high-volume items surface in a review queue
- [x] Manager decisions persist as org-scope overrides
- [x] No third-party model receives customer app or URL data

**Depends on** — **CLS-1**.

---

# Phase 5 — URL / Network Destination Visibility

**What exists today:** `read_browser_url` (`window.rs`) UI-scrapes the **foreground browser tab's** address bar — PowerShell UIAutomation on Windows, AppleScript on macOS. It sees exactly one tab, in a supported browser, when it is the active window.

It is **blind to** background tabs, other browsers, native-app network calls (Slack, Discord, games, torrent clients), anything inside a VM or on a second device, and anything behind a VPN or proxy. It cannot answer "where is this machine's traffic actually going."

Three rungs, increasing in invasiveness, legal load, and effort.

---

### URL-1 🟠 Browser extension for full tab coverage — **the recommended investment**

**Change** — A signed extension (Chrome/Edge/Firefox/Safari) reporting *all* open tabs and navigations to the local agent over its existing loopback server (`tiny_http` on `:18890`). Captures every tab in supported browsers including background ones, with **no TLS interception and no CA install**.

This also **replaces** the current per-capture PowerShell/osascript child-process spawn (`read_browser_url`), which is heavy — a process spawn roughly every 15s while browsing — and fragile, since its "script not found" path silently disables URL capture entirely.

Limitation: browsers only, and users can disable extensions — which is detectable, so flag "extension not present" as a signal.

**Acceptance**
- [ ] All open tabs are reported, not only the foreground one
- [ ] The per-capture script spawn is removed from the agent
- [ ] Extension-absent is detected and surfaced
- [ ] Lawful under CF-1/CF-2 disclosure with no additional consent tier

**Depends on** — **CF-1**, **CF-2**.

---

### URL-2 🟡 DNS-level destination logging

**Change** — Log the machine's DNS queries for a domain-level map of *all* network destinations, including native apps. Options: a local DNS proxy the agent points the system resolver at, or reading the OS DNS cache / ETW (Windows) / unified log (macOS).

**Honest limits:** you get **domains, not full URLs**, and modern **DNS-over-HTTPS bypasses it entirely** (Chrome and Firefox default to DoH, tunnelling DNS inside HTTPS to a resolver you cannot see). Partial, and degrading over time. Build only if native-app destinations genuinely matter, and disclose DNS logging explicitly in the CF-2 notice.

**Depends on** — **CF-1**, **CF-2**, **CF-4**.

---

### URL-3 🔴 Full traffic interception — gated enterprise module only

**Change** — Seeing all traffic including inside TLS requires a system-wide MITM proxy installing a **root CA**, or a packet-capture driver. This is the most invasive capability in the plan and is **lawful only when *all* of the following hold** — enforce them in code via CF-1, never rely on the customer to self-police:

- **Managed corporate device only.** Never BYOD (CF-6). The registry must refuse to enable this for any device not attested as company-owned and MDM-managed.
- **Jurisdiction profile permits it** (CF-4). Effectively unavailable under EU/UK and in two-party-consent US states — the toggle must not appear there.
- **Explicit, specific, written consent** per employee (CF-1 `consented_at`) plus the CF-2 disclosure naming traffic decryption in plain language. Generic "we may monitor" boilerplate is not sufficient for TLS decryption.
- **CA pushed via MDM**, not silently by the agent — keeps it an auditable IT act and lets certificate-pinned apps (banking, health) be excluded so they don't break.
- **Purpose-locked and minimised** (CF-3), with the same retention and access controls as everything else.

**Never ship this as a default or on-by-default feature.** Build it, if at all, as a separately-gated enterprise module CF-1 unlocks only when every condition is satisfied for that org and device.

**Depends on** — **CF-1**, **CF-3**, **CF-4**, **CF-6**.

---

# Phase 6 — Distribution

## Microsoft Store: two paths, and why the cheap one is genuinely cheaper

Microsoft opened the Store to full Win32 apps in 2021, so there are two routes — and they differ by far more than packaging effort:

- **Path B — list the existing Win32 installer.** List the NSIS/MSI Tauri already builds (`tauri.conf.json` → `bundle.targets: ["nsis","msi"]`). The Store becomes a discovery and distribution front for the installer you already ship. **Requires DIST-1 and DIST-8 only.** Nothing about the app changes.
- **Path A — MSIX with `runFullTrust`.** Package the built binaries as MSIX declaring the `runFullTrust` restricted capability, keeping the app full-trust (**not** the AppContainer sandbox), so input hooks (ACT-1), `xcap` screen capture, foreground-window reads, and DPAPI/Keychain calls keep working. Tauri v2 does not emit MSIX natively, so the built output is packaged separately (`makeappx` + `signtool`, MSIX Packaging Tool, or Advanced Installer). **Additionally requires DIST-3 through DIST-7**, because packaging changes app identity, install location, update mechanism, and autostart — four things this agent currently depends on.

**Recommendation: Path B first.** Not merely because it's faster — because DIST-4 and DIST-5 are outright **breakages** of shipped behaviour that Path B avoids entirely. Take Path A later, deliberately, when the cleaner install/update experience is worth reworking the updater and autostart.

Keep **Authenticode/EV code signing** on both paths — it also clears SmartScreen for the direct-download build.

**Certification reality, and why Phase 1 is the enabler.** Store review scrutinises monitoring and tracking apps hard, and what they require is exactly what CF-1..CF-5 build: a clear privacy policy, disclosed non-covert collection, a visible "you are being monitored" posture, and no stealth mode. Do Phase 1 first and certification becomes paperwork rather than a rejection loop. Present the app honestly as consented workplace monitoring, not as surveillance.

> **Verify current requirements against Partner Center before submitting.** Store policies, required listing fields, and MSIX manifest rules change. Everything below reflects the shape of the process and the specific things *this* codebase gets wrong; treat exact field names and policy clauses as things to confirm at submission time, not as quoted policy.

---

### DIST-1 🟠 Partner Center enrollment and listing prerequisites

**Applies to:** Path A **and** Path B. Nothing ships without this.

**Problem** — None of the account, identity, or listing groundwork exists, and several items have external lead times that are not in this team's control.

**Change** — Complete, in roughly this order:

| Item | Note |
| :--- | :--- |
| **Partner Center account** | A **company** account (not individual) — this is a B2B workplace product. Company accounts require business verification, which is an external wait |
| **Reserve the app name** | Reserving early also fixes the Package Identity Name used by DIST-3 |
| **Privacy policy URL** | **Mandatory** — the app collects personal data (screenshots, app usage, URLs, activity). Must accurately describe what CF-1 actually enables, or the listing contradicts the product |
| **Age rating (IARC questionnaire)** | Answer honestly about data collection; a wrong answer here is a rejection |
| **Reviewer test account + written repro steps** | **The single most common rejection cause for this class of app.** A reviewer cannot exercise the agent at all without a signed-in account linked to a dashboard org with a project and a task. Supply working credentials, a pre-seeded org, and step-by-step instructions covering sign-in, linking, starting a timer, and where the monitoring disclosure appears |
| **Store listing assets** | Screenshots, icons, description, feature list. Describe monitoring plainly — do not soften it |
| **Support contact + website** | Required fields |
| **Export/encryption declaration** | The app uses HTTPS and encrypts stored tokens (MAC-1); declare accordingly |

**Acceptance**
- [ ] Company account verified and app name reserved
- [ ] Privacy policy published at a stable URL and matches what CF-1 permits
- [ ] A reviewer can go from install to a running tracked session using only the supplied credentials and instructions
- [ ] Listing text describes monitoring accurately, with no stealth or covert framing
- [ ] Age rating submitted with accurate data-collection answers

**Depends on** — **CF-2** (there must be a real disclosure surface for the listing and policy to describe).

---

### DIST-2 🟠 macOS notarized direct download

The correct and only viable macOS channel — see **Appendix D**. Covered operationally by **MAC-4**.

**Depends on** — **MAC-1**, **MAC-2**, **MAC-4**.

---

### DIST-3 🟡 MSIX packaging with `runFullTrust` (Path A)

**Problem** — Tauri emits NSIS/MSI only. MSIX must be produced from the built output, and its manifest has constraints the current config violates.

**Change**
- Package with `makeappx` + `signtool` (or MSIX Packaging Tool / Advanced Installer) in CI.
- Declare `runFullTrust` as a restricted capability, with the justification from DIST-8.
- **Manifest `Publisher` must exactly match the Store-assigned publisher identity** (`CN=…` from Partner Center), not the display string. `bundle.publisher` is currently `"The Virtual Callers"` — that is a display name, not an identity, and a mismatch is an automatic package rejection.
- **Version must be 4-part `Major.Minor.Build.Revision` with Revision = 0.** `tauri.conf.json` currently has `"version": "0.4.0"` (3-part semver). Define and script the mapping (`0.4.0` → `0.4.0.0`) rather than hand-editing per release — see DIST-7.
- Package Identity Name must match the reserved name from DIST-1. The current `identifier` is `com.virtualtracker.agent`; the MSIX identity is a separate, Store-assigned value.
- Pass the **Windows App Certification Kit (WACK)** locally before submitting.
- Bundled resources (`scripts/get-browser-url.ps1`) live in a **read-only** package directory under MSIX. Confirm the script still executes from there, and note that URL-1 removes this dependency entirely — another reason to land URL-1 before Path A.

**Acceptance**
- [ ] MSIX builds in CI and is signed
- [ ] WACK passes with no failures
- [ ] Manifest publisher identity matches Partner Center exactly
- [ ] Version is 4-part with revision 0, generated not hand-edited
- [ ] Every capability (hooks, screen capture, window titles, token storage) works identically to the NSIS build, verified on a clean machine

**Depends on** — **DIST-1**, **DIST-4**, **DIST-5**, **DIST-7**.

---

### DIST-4 🔴 Disable the self-updater in packaged builds (Path A)

**Problem** — The Tauri updater is **active** and pointed at GitHub releases:

```jsonc
// src-tauri/tauri.conf.json
"plugins": { "updater": { "active": true, "endpoints": ["https://github.com/.../latest.json"], … } }
```

and `App.tsx` calls `checkForUpdate()` on mount, which runs `update.downloadAndInstall()` then `relaunch()`.

**MSIX package contents are immutable.** A packaged app cannot overwrite its own binaries, so the updater cannot succeed — it will fail, and depending on how the failure surfaces, either error repeatedly or leave the app in a confused state. Independently, an app that self-updates outside the Store is a policy problem: the Store owns update delivery for packaged apps.

**Change** — Make the updater conditional on distribution channel, not compiled in unconditionally. A build-time feature flag or a `dist_channel` value in the existing `Settings` plumbing (`store` | `direct`) is enough; the Store build sets `active: false` and skips the `checkForUpdate()` call, while the direct-download build is unchanged.

Do **not** simply delete the updater — the direct-download build (and macOS, MAC-4) still needs it.

**Acceptance**
- [ ] Store build never calls `checkForUpdate()` and ships with the updater plugin inactive
- [ ] Direct-download build updates exactly as it does today, on both Windows and macOS
- [ ] Which channel a running build is is visible in logs/UI for support
- [ ] No user-visible update error in the Store build

**Depends on** — nothing. **Blocks** — **DIST-3**.

---

### DIST-5 🔴 Replace registry autostart with the packaged StartupTask extension (Path A)

**Problem** — Autostart uses `tauri-plugin-autostart` (`Cargo.toml:23`, wired at `lib.rs:130`/`195-203`/`272`/`323`, permissions in `capabilities/default.json:17-19`). On Windows that plugin writes an `HKCU\…\CurrentVersion\Run` entry.

Packaged apps do not get autostart that way — registry writes are virtualized under MSIX, and the supported mechanism is a **`windows.startupTask` extension declared in the package manifest**, which the user can then enable/disable in Windows Settings. So "Launch at login" — a user-facing preference this app already exposes — **silently stops working** in an MSIX build.

**Change** — Declare the `startupTask` extension in the MSIX manifest, and branch `apply_autostart` (`lib.rs:195`) on distribution channel: packaged builds query and toggle the StartupTask state; direct builds keep the existing plugin path. If the packaged API cannot toggle programmatically in the way the current UI assumes, the preference must become "open Windows Settings to enable" rather than a silently-failing switch.

**Acceptance**
- [ ] Launch-at-login works in the MSIX build, verified by reboot
- [ ] The preference UI reflects the actual OS state, never a stale local value
- [ ] Direct-download autostart behaviour is unchanged
- [ ] Disabling in Windows Settings is reflected back in the app

**Depends on** — nothing. **Blocks** — **DIST-3**.

---

### DIST-6 🟠 Verify loopback and packaged-identity behaviour (Path A)

**Problem** — Two things the agent relies on can behave differently under a package identity:

1. **The loopback HTTP server** (`tiny_http`, `src-tauri/src/auth/server.rs:43`, binding `127.0.0.1:<port>`) handles the auth/link flow and is the intended transport for the URL-1 browser extension. Packaged apps have loopback restrictions; a browser talking to a packaged app over localhost is exactly the case that needs confirming, not assuming.
2. **Storage paths.** Packaged apps get redirected/virtualized AppData. Token storage, the offline event queue (`queue.rs`), and logs may land somewhere different from the NSIS build — which also means an existing user migrating from the direct build could appear signed out.

**Change** — Test both on a real packaged install, before committing to Path A. If loopback from a browser is blocked, URL-1's transport needs rethinking for the Store build specifically. Define and test the migration path for a user moving from the direct install to the Store install.

**Acceptance**
- [ ] Auth/link flow completes in the packaged build
- [ ] The browser extension (if URL-1 has landed) reaches the agent's loopback server
- [ ] Token, queue, and log locations are known and documented for the packaged build
- [ ] A user migrating from the direct install either keeps their session or is given a clear re-link prompt — never a silent signed-out state

**Depends on** — **DIST-3** in practice (needs a real package to test against); inform DIST-3's go/no-go with the loopback result.

---

### DIST-7 🟠 Build-channel plumbing

**Problem** — DIST-4, DIST-5, and DIST-6 all branch on "is this the Store build?", and DIST-3 needs a generated 4-part version. There is currently no notion of a distribution channel anywhere in the build.

**Change** — One channel value threaded through the build (`store` | `direct`), consumed by the updater toggle, the autostart path, and logging. Script the semver → 4-part version mapping in CI so `0.4.0` becomes `0.4.0.0` without hand-editing. Keep `NSIS installMode: perMachine` in mind — MSIX installs per-user by default, so support docs and any per-machine assumptions need checking.

**Acceptance**
- [ ] One flag controls all channel-dependent behaviour; no scattered conditionals
- [ ] CI produces both artifacts from one commit
- [ ] Version mapping is generated, never hand-edited
- [ ] The running channel is visible in logs and in the app's about/settings surface

**Blocks** — **DIST-3**.

---

### DIST-8 🟠 Store review dossier for a monitoring app

**Applies to:** Path A **and** Path B.

**Problem** — Tracking-class apps are reviewed by a human who will ask why the app needs to watch input, capture screens, and read other apps' windows. Answering that ad hoc, per rejection, is how submissions take months.

**Change** — Prepare once, submit with the package:
- **Capability justification** — for `runFullTrust` (Path A), and for the behaviour generally: what each capability is used for, why a sandboxed alternative cannot deliver it, and which CF-1 policy toggle governs it.
- **Evidence of disclosure and consent** — screenshots of the CF-2 first-run notice and the persistent tracking indicator. This is the single strongest argument that the app is consented workplace monitoring rather than covert surveillance.
- **Statement that no stealth mode exists** — and make sure it's true. There must be no build flag, env var, or config path that hides the indicator (CF-2's acceptance criteria).
- **Data handling summary** — what is collected, retention ceilings (CF-5), who can access it, and the DSAR/erasure path. Mirrors the privacy policy from DIST-1.
- **Reviewer instructions** — cross-reference DIST-1's test account.

**Plan for at least one rejection-and-resubmit cycle** on first submission of a tracking app, and keep the dossier under version control so the resubmit is an edit rather than a rewrite.

**Acceptance**
- [ ] Dossier written, reviewed, and stored in the repo
- [ ] Every claim in it is verifiable in the shipped build
- [ ] Disclosure screenshots come from the actual build being submitted
- [ ] A rejection response can be produced by editing this document, not starting over

**Depends on** — **CF-2**, **CF-5**, **DIST-1**.

---

# Phase 7 — Observability & Code Quality

---

### OBS-1 🟡 Reconcile the three counter stores

**Problem** — Nothing checks whether `activity_sessions.active_seconds`, `task_member_progress.active_seconds`, and `daily_member_active_seconds` still agree. After the Phase 0 defects they demonstrably can diverge, silently. The entire bug class in this plan was found by a user staring at a clock.

**Change** — A daily job comparing the three stores per member/day, **logging** drift beyond a few seconds. Log, do not auto-correct — discrepancy is the alarm; silent correction hides the cause.

**Acceptance**
- [x] Job runs daily and reports per-member drift
- [x] Drift beyond threshold alerts rather than self-heals
- [x] Baseline drift after Phase 0 is approximately zero

---

### OBS-2 🟡 Count every downward write of recorded seconds

**Change** — A counter on every accepted decrease, tagged by reason (idle rewind / clean stop / **unexplained**). After TC-4, "unexplained" should be zero; if it isn't, something is still wrong.

**Acceptance**
- [x] Every decrease is counted and reason-tagged
- [x] "Unexplained" is alertable and is zero in steady state

**Depends on** — **TC-4**.

---

### OBS-3 🟡 Alert on abandoned-session closures

**Change** — Alert on closures per minute. After TC-1 this is near-zero in normal operation, so a spike is a real incident rather than background noise — and it would have made the Redis dependency obvious immediately.

**Acceptance**
- [x] Closure rate is a monitored metric with an alert threshold
- [x] A Redis outage no longer produces a spike (because TC-1 removed the dependency)

**Depends on** — **TC-1**.

---

### CQ-1 🟡 Graceful shutdown for the activity meter thread

**Problem** — `ActivityMeter::run_listeners` (`activity.rs:45`) is an infinite `loop` with no stop flag; once `start()` spawns it, it runs until the process dies. Low impact today, but when ACT-1 swaps in OS hooks those **must** be unregistered on stop/sign-out or they leak system-wide hooks.

**Change** — Add the stop signal now so the hook migration is clean.

**Acceptance**
- [x] The meter thread exits on stop/sign-out
- [x] No hooks remain registered after the tracker stops (verify with a system tool after ACT-1)

**Blocks** — **ACT-1** (do this first or the hook migration leaks).

---

### CQ-2 🟡 Midnight attribution for rollup deltas

**Problem** — `recordDailyActiveSecondsDelta` (`activity-events-postgres.service.js:417-441`) applies every delta to `CURRENT_DATE` with `GREATEST(0, …)` on both branches. The clamp is correct and the code says so, but two consequences follow: a rewind just after midnight takes time off **today**, which had none, so it clamps at 0 and yesterday keeps hours the session no longer claims — leaving rollups and `activity_sessions` permanently disagreeing. And because caps read the rollup (`sumDailyMemberActiveSeconds`), a clamped-away negative inflates next-day allowance.

**Change** — Attribute the delta to the day the session *started* (the row has `started_at`), or split across days for sessions crossing midnight.

**Acceptance**
- [x] A rewind after midnight debits the day the time was earned
- [x] Rollups and `activity_sessions` reconcile for midnight-crossing sessions (checked by OBS-1)
- [x] Do before per-day reporting is sold as exact

---

### CQ-3 🟡 Retire the hand-rolled DPAPI

Covered by **MAC-1** — flagged separately only because it is a net code reduction, which is rare. No separate work.

---

### CQ-4 🟡 Single source of truth for the browser/app list

`BROWSER_EXES` in Rust and `display-names.ts` in the frontend enumerate browsers independently and will drift. Covered by **CLS-1** + **MAC-3**. No separate work.

---

### CQ-5 🟡 Remove the per-capture URL script spawn

Covered by **URL-1**. No separate work — noted so it isn't planned twice.

---

# Appendix A — Root-cause analysis: the backward clock

Reported symptom: mid-session the "Elapsed · Tracking" number on the tray widget drops — the client recalls crossing ~52 minutes and falling back to ~47. Three screenshots from one session (Aug 3, 8:26–8:30 PM) capture it at smaller magnitude:

| Wall clock | "Elapsed · Tracking" | "Today, all work" | Gap |
| :--- | :--- | :--- | :--- |
| 8:26 PM | `00:43:47` | `43m 35s` | +12s |
| 8:27 PM | `00:45:23` | `43m 35s` | **+1m 48s** |
| 8:30 PM | `00:44:47` ⬅ **down 36s** | `44m 25s` | +22s |

The two columns are different counters:
- **"Elapsed · Tracking"** — a *local* 1-second ticker (`liveActiveSeconds`, `App.tsx:788`).
- **"Today, all work"** — the *server's* number (`memberLimits.workedTodaySeconds`, `App.tsx:1299` → `sumDailyMemberActiveSeconds` over `daily_member_active_seconds`).

The local ticker drifts ahead (+12s → +1m48s), then is yanked back down (+22s). One counter is counting real seconds; the other is counting fewer; and the resync trusts the slower one unconditionally. **Both halves are bugs, and they are not independent** — TC-2's drift is what turns TC-3's ≤20s sawtooth into a multi-minute drop, and it grows the longer a session runs.

Three causes, addressed by **TC-2** (agent credits assumed rather than measured time), **TC-3** (UI resync has no monotonic guard, unlike the web dashboard), and **TC-1** (a Redis blip closes the session outright, resetting the clock to zero rather than merely lowering it).

Three further events enlarge the drop: a network blip or sleep/wake skipping syncs; the idle-escalation rewind deliberately posting a lower value (correct behaviour the UI cannot distinguish from a stale read); and the TC-1 wipe.

**Test that proves all three fixed:** run a 30-minute session on a throttled connection and assert the displayed clock is monotonic throughout *and* lands within a few seconds of wall-clock. TC-2 fails the second half; TC-3 fails the first; TC-1 fails both, loudly.

---

# Appendix B — ADR: Should the timer use the Realtime (Redis) DB directly?

**Status:** Proposed · **Decision: No for the bug; a narrow later role at most.**

### Context

There is a live Redis instance (`Virtual-Tracker-RealTime-db`, `redis:7.2`, internal-only, no public exposure, no SSL — correct for an internal service). The question was whether pointing the timer at it directly would improve anything, asked as a design question rather than a fix hunt.

Stated plainly first: **Redis is already load-bearing in the timer path, in the worst possible direction.** It backs `presence-pubsub.js` / `presence-store-redis.js` for online/offline status and — via `agent-heartbeat.js` — is the *sole* signal deciding whether a running session is alive or abandoned. This is not a greenfield adoption question. Redis is in the critical path, it is in it fail-closed (TC-1), and it is in it undocumented.

### Options

**A — Timer state lives in Redis, Postgres written periodically.** Fixes the reported bug: **no**. Timer seconds are billing data; putting the authoritative copy in a store currently tuned for ephemeral presence trades a display bug for a data-loss bug, and contradicts the standing Postgres-as-record direction. Cheap high-frequency writes and natural pub/sub fan-out are real benefits, but they address a problem nobody has yet.

**B — Postgres authoritative; Redis pub/sub as live transport only.** Fixes the reported bug: **no**, but removes the cadence mismatch that amplifies it. Reuses the working `presence-pubsub.js` pattern. Kills the 5s poll from every agent and every dashboard tab. Durability unchanged. Cost: a whole channel to build and operate for something TC-3's `Math.max` already makes invisible.

**C — Change nothing about storage; fix the three causes.** Fixes the reported bug: **yes, entirely.** One Rust function, one React effect, one backend predicate. Durability *improves* (TC-1 stops destroying sessions).

### Decision — take C now; B is a legitimate later improvement; A is a no

None of the three root causes is a storage problem:

- **TC-2** is arithmetic in the agent — crediting an assumed 5s instead of measured wall time. Wrong against Redis, Postgres, a text file, or a clay tablet.
- **TC-3** is a client accepting a lower number as truth. Swap the database and `setLiveActiveSeconds(session?.activeSeconds ?? 0)` still snaps backward on the same stale read.
- **TC-1** is Redis being consulted fail-closed. **Leaning harder on Redis makes this worse**, widening the blast radius of the exact component whose failure already wipes every live session.

That last point is the crux. The instinct "we have a realtime DB, should the realtime-feeling feature use it?" is reasonable, but the evidence points the other way: the timer's most severe failure mode *is* its Redis dependency. Reduce Redis's authority over timer correctness (TC-1 removes it entirely, using a column that already exists), and only then consider adding it back in a strictly non-authoritative role.

### Consequences

- **Easier:** a Redis outage degrades presence indicators only — which is what an ephemeral store should be allowed to fail at.
- **Harder:** nothing. TC-1 does not foreclose Option B.
- **Revisit when:** poll load from the agent fleet plus open dashboard tabs is measurably a problem, or product wants sub-second live timers. Then build B — agent publishes a tick, backend fans out over the existing pub/sub, Postgres keeps the record. Tracked as a deferred item; not before.

---

# Appendix C — Jurisdiction profiles (input to CF-4)

| Profile | Constraints the code must enforce |
| :--- | :--- |
| **EU / UK (GDPR)** | Lawful basis + **DPIA** required for systematic monitoring (Art. 35); works-council consultation in DE/AT/NL/FR; strict proportionality; DSAR/erasure rights; no covert monitoring. **URL-3 effectively unavailable.** |
| **US — one-party-consent states** | Employer notice generally suffices on company devices; **BIPA** (IL) and similar restrict any biometric capture. |
| **US — two-party/all-party-consent** (CA, FL, IL, MD, MA, MT, NH, PA, WA…) | **All-party consent required for audio**; strong expectation-of-privacy limits. No audio capture without explicit consent. |
| **Other** | Default to the strictest applicable posture until counsel confirms otherwise. |

CF-1's `jurisdiction_profile` decides which capabilities are *offerable*, not merely enabled. A capability unavailable in a profile does not render as a toggle and is rejected server-side if requested directly.

---

# Appendix D — Why the Mac App Store is excluded

The Mac App Store **mandates the App Sandbox**, and the sandbox **forbids every core capability this agent needs**:

| Capability | MAS App Sandbox |
| :--- | :--- |
| Monitor other apps' keyboard/mouse (`CGEventTap`, ACT-1) | **Forbidden** — no system-wide input taps |
| Capture other apps' screens (`xcap`) | **Forbidden** — capture limited to the app's own content |
| Read other apps' window titles (Accessibility / `CGWindowList`, MAC-2) | **Forbidden** |
| AppleScript-automate Safari/Chrome for URLs | **Forbidden** — cross-app Apple Events blocked |
| Read other processes / VM detection (AC-3) | **Forbidden** |

On top of the technical wall, Apple's App Review guidelines explicitly reject monitoring/surveillance-class apps for the consumer store. Both point the same way: **the functional agent cannot ship through MAS.** This is a category exclusion, not a gap to close — and it is why no serious competitor (Hubstaff, Time Doctor, ActivTrak) distributes its Mac agent that way.

**The correct channel is MAC-4 / DIST-2:** Developer ID signing + notarization + direct DMG. It installs cleanly, passes Gatekeeper, and keeps every capability. Screen Recording and Accessibility still require TCC grants on first run — but outside the sandbox they are grantable, whereas inside MAS they are simply unavailable. This is not a downgrade from MAS; it is the professional distribution channel for this category.

*Optional nuance:* a neutered companion app (view-your-own-stats only, no monitoring) could ship to MAS for discoverability, with the real agent as a notarized download. Only worth it if MAS presence has marketing value — it is extra work for a stats viewer, not the product.

---

# Appendix F — ADR: Windows distribution strategy

**Status:** Decided.

**Decision: Path B (list the existing installer) is the Store channel. DIST-3/4/5/7 are re-scoped from "Store packaging" to "enterprise MSIX for MDM deployment" — same artifact, different purpose, not wasted.**

### Reasoning

**Release velocity decides it.** Phase 0 just found three 🔴 timer bugs silently mis-recording billable hours. Path A puts every future fix behind Store certification of a monitoring app — slow, sceptical review for this category. Path B keeps the app's own updater, so a fix ships in hours, not whenever a reviewer gets to it. For a product whose core failure mode is silent data corruption, that gap is decisive on its own.

**The Store was never the long-run distribution channel anyway.** This is a B2B workplace agent. Real deployment at scale is IT pushing it fleet-wide via Intune/SCCM/Group Policy — the same model Hubstaff, Time Doctor, and ActivTrak use. The Store is a discovery/credibility surface, not how a 200-seat customer installs 200 agents. So the long-run shape is three channels: direct download (fast fixes), enterprise MSI/MSIX via MDM (real deployment), Store listing via Path B (credibility, SmartScreen trust).

**MSIX-the-format still has value; MSIX-the-Store-path doesn't.** Intune deploys MSIX well. DIST-3/4/5/7 build a real artifact for real IT deployment — they're re-scoped, not dropped. And the two 🔴 items in that work stop being breakages once re-scoped: enterprise IT owns update cadence, so disabling the self-updater is correct there; admins configure autostart via policy, so StartupTask is correct there. They were only breakages when bolted onto a consumer Store install nobody manages centrally.

**Open items surfaced by this ADR, tracked as DIST-6 and a new DIST-9:**
- DIST-6's loopback-under-packaging risk applies to the *enterprise* MSIX now, not a Store submission — still needs verifying before URL-1's browser extension can be promised to MSIX-deployed fleets.
- **DIST-9 (new, 🟡):** MSIX StartupTask is user-toggleable from Windows Settings — an employee can disable the monitoring agent's autostart from the OS. Not a compliance problem (CF-2 forbids stealth regardless), but an attendance-integrity gap worth a flag: MDM-deployed fleets should have autostart policy-locked, not merely defaulted on.

### What would flip this
Microsoft mandating MSIX for new Store submissions, or a specific large customer requiring Store-only procurement. Neither is true today.

### Action items
1. [ ] DIST-1 + DIST-8 target Path B only — drop any Path-A-specific listing prep from those tasks
2. [ ] Re-title DIST-3/4/5/7 internally as "enterprise MSIX" work; acceptance criteria unchanged, audience changed
3. [ ] Add **DIST-9** — policy-lock autostart for MDM-deployed installs, alongside DIST-5
4. [ ] Revisit this ADR only against the triggers above

---

# Appendix E — Rollout notes

**Schema changes** — every DDL in this plan goes in `Dashboard-Backend/src/lib/postgres/ensure-lookup-schema.js`, idempotent, since it runs on every boot and there is no manual migration step. A statement that can fail against existing data (TC-7's unique index) needs its cleanup in the same file, guarded, ahead of the DDL — otherwise it becomes a boot failure rather than a migration error.

**Branching** — commit to a working branch, sync `main`, then sync the relevant per-service production branches. Phase 0 spans three services (`Tauri-App-Extension`, `Dashboard-Backend`, `Dashboard-Web`), so confirm which production branches each fix needs before merging.

**Backfill decision — settle this before Phase 0 ships.** Once TC-2 lands, recorded hours will visibly *increase* for the same work, because they stop being short. Decide whether historical data gets a corrective backfill (drift is estimable per session from `started_at`/`ended_at` versus `active_seconds`, so approximate reconstruction is possible) or whether the fix applies going forward with an explanation to affected clients. Either is defensible. Silently changing the numbers without deciding is not. The same question, smaller, applies to any TC-1 outage that stopped timers people were working through.

**Order of operations for Phase 0** — TC-1 first (largest active blast radius), then TC-2 before TC-3 (non-negotiable), then TC-4 → TC-5, with TC-6 and TC-7 independent. Ship Phase 0 as its own release ahead of the rest of the plan.

---

# Status Checklist

One line per task ID — what shipped, what's still open, and why. The per-acceptance-criteria checkboxes above this line are the source of truth for *what a task means*; this table is the source of truth for *what's left to schedule*.

## Phase 0 — Timer correctness

| ID | Status | Note |
|----|--------|------|
| TC-1 | ✅ Done | Fail-open abandonment detection, Redis removed from the decision path |
| TC-2 | ✅ Done | Credits real measured wall time |
| TC-3 | ✅ Done | Monotonic displayed clock |
| TC-4 | ✅ Done | Per-action downward-write clamp |
| TC-5 | ✅ Done | Sync-time cap actually fires |
| TC-6 | ✅ Done | Failed idle-stop retried, never silently resumed |
| TC-7 | ✅ Done | One open session per member, idempotent index |

## Phase 1 — Legal & compliance

| ID | Status | Note |
|----|--------|------|
| CF-1 | ✅ Done | Consent/config registry with audit trail |
| CF-2 | ✅ Done | Mandatory in-agent disclosure |
| CF-3 | ✅ Done | Data minimization (exclusions, domain-only mode, no keystroke content) |
| CF-4 | ✅ Done | Jurisdiction profiles, server-enforced |
| CF-5 | ✅ Done | Retention limits & DSAR/erasure |
| CF-6 | ✅ Done | Device ownership scoping |

## macOS enablement

| ID | Status | Note |
|----|--------|------|
| MAC-1 | ✅ Done | Keychain-encrypted tokens |
| MAC-2 | ✅ Done | Real foreground-window detection |
| MAC-3 | ✅ Done | Cross-platform app-name mapping |
| MAC-4 | ⬜ Not started | Signing, notarization, packaging — needs a real Mac + Apple Developer account, can't be done from this environment |

## Activity accuracy

| ID | Status | Note |
|----|--------|------|
| ACT-1 | ✅ Done | Real OS-level input hooks replace polling |
| ACT-2 | ✅ Done | Weighted, anti-macro scoring |
| ACT-3 | ✅ Done | All server-tunable constants (scoring, screenshot cadence, idle thresholds) |
| ACT-4 | ✅ Done | Richer per-capture signal sent to backend |

## Anti-cheat

| ID | Status | Note |
|----|--------|------|
| AC-1 | ✅ Done | Injected-input detection, persisted as a reviewable/contestable flag |
| AC-2 | ✅ Done | Screenshot/activity correlation (perceptual hash + category conflict) |
| AC-3 | ✅ Done | VM/sandbox detection, device-level weighted flag, built last as specified |
| AC-4 | ✅ Done | Session-level integrity score with view/contest |

## Classification & focused time

| ID | Status | Note |
|----|--------|------|
| CLS-1 | ✅ Done | App/domain category map + unified display names |
| CLS-2 | ✅ Done | Focused-time metric |
| CLS-3 | ✅ Done | Review queue for unclassified items |

## Browser/URL coverage

| ID | Status | Note |
|----|--------|------|
| URL-1 | ⬜ Won't build | Browser extension — a real per-browser install/store-review flow (Chrome Web Store, AMO, Edge Add-ons, Safari notarization) isn't practically achievable from this environment; call made explicit rather than left as a perpetual "not started". A receiving-plumbing prototype (loopback endpoint + pairing secret + extension-presence detection in `Tauri-App-Extension`) was built and then deliberately reverted for this reason - see git history around this line if it's ever revisited. Any future URL-coverage work should improve the *existing* per-capture script-spawn URL reader (`read_browser_url`/`get-browser-url.ps1`) inside `Tauri-App-Extension` instead of assuming an extension will ever exist. |
| URL-2 | ⬜ Not started | DNS-level destination logging — not built |
| URL-3 | ⬜ Deliberately not built | Full traffic interception — explicitly gated, enterprise-only, not-default per the plan's own text |

## Distribution

| ID | Status | Note |
|----|--------|------|
| DIST-1 | ⬜ Not started | Partner Center enrollment — needs a company account and human decisions (listing text, age rating) |
| DIST-2 | ⬜ Not started | macOS notarized direct download — needs a real Mac + Apple account |
| DIST-3 | ⬜ Not started | MSIX packaging — needs Partner Center identity + a Windows signing cert |
| DIST-4 | ⬜ Not started | Disable self-updater in packaged builds — depends on DIST-3 shipping first |
| DIST-5 | ⬜ Not started | StartupTask extension — depends on DIST-3 |
| DIST-6 | ⬜ Not started | Verify loopback/packaged-identity behaviour — needs a packaged build to test against |
| DIST-7 | ⬜ Not started | Build-channel plumbing (CI) — needs CI infra decisions |
| DIST-8 | ⬜ Not started | Store review dossier — a document, needs a human author + real screenshots from a submitted build |
| DIST-9 | ⬜ Proposed, not started | New in Appendix D's ADR: policy-lock autostart for MDM-deployed installs, alongside DIST-5 |

Appendix D's own **Action items** (re-scope DIST-1/8 to Path B, re-title DIST-3/4/5/7 as enterprise-MSIX work, add DIST-9, revisit only on trigger) are also still open — they're decisions/paperwork, not code.

## Observability & code quality

| ID | Status | Note |
|----|--------|------|
| OBS-1 | ✅ Done | Daily reconciliation of the three counter stores, logs drift only |
| OBS-2 | ✅ Done | Every downward write counted and reason-tagged |
| OBS-3 | ✅ Done | Abandoned-session closure rate alertable |
| CQ-1 | ✅ Done | Graceful shutdown for the activity meter thread |
| CQ-2 | ✅ Done | Midnight attribution for rollup deltas |
| CQ-3 | ✅ Done | No separate work — covered by MAC-1 |
| CQ-4 | ✅ Done | No separate work — covered by CLS-1 + MAC-3 |
| CQ-5 | ⬜ Won't resolve | No separate work planned; was contingent on URL-1 removing the per-capture URL script spawn, and URL-1 itself won't build (see above) - the script spawn stays permanently, so this stays permanently open unless revisited on its own |

## Desktop app auth & layout (Phase 2, outside the original scope of this plan)

Requested as a follow-up: social login, account creation, forgot-password reachable from the desktop app itself, and a layout fix so the timer/dashboard chrome doesn't render while logged out. Corrected an initial wrong assumption mid-work: Google/Apple/sign-up/forgot-password were already fully built and working on Dashboard-Web's login page (`features/auth/pages/login-page.tsx`) — the actual gap was entirely on the desktop side, which only exposed email/password and a generic browser-link button that (bug) never carried the device-link token for the create-account/forgot-password paths.

| ID | Status | Note |
|----|--------|------|
| AUTH-1 | ✅ Done | "Continue with Google"/"Continue with Apple" buttons in the desktop app - deep-link into the browser with `?link=<token>&provider=google\|apple`; `login-page.tsx` reads the hint and auto-runs that provider's existing sign-in |
| AUTH-2 | ✅ Done | "Create account" now opens the browser with the device-link token (`?mode=signup`) instead of the old token-less `open_web_app` call, which never actually linked the device |
| AUTH-3 | ✅ Done | "Forgot password?" - same link-token fix, `?mode=forgot-password` |
| LAYOUT-1 | ✅ Done | `.page-area` (timer/dashboard) only renders when `signedIn`; logged out, `.app-body` switches to a centered, full-viewport auth-only layout via a new CSS modifier, not an empty second pane |

**Verified:** `cargo build`/`cargo test` (63/63) and `tsc --noEmit` clean on Tauri-App-Extension. **Not verified:** no `tauri dev` visual smoke test was run (can't launch the desktop window from this environment) — worth clicking through before shipping.

## At a glance

**Done: 34 of 48 numbered tasks from the original plan** (everything buildable from this environment with backend + Rust access alone), **plus 4 of 4 Phase 2 desktop auth/layout tasks** requested as a follow-up.

**Left, and why:**
- **MAC-4, DIST-2** — need a real Mac + Apple Developer account.
- **DIST-1, DIST-3, DIST-5, DIST-6, DIST-7, DIST-8, DIST-9** — need Partner Center/CI accounts, a Windows signing cert, or a human-authored document; DIST-4/5 also block on DIST-3 shipping first.
- **URL-1** — won't build; per-browser store distribution for an extension isn't practically achievable from this environment. Future URL-coverage effort should improve the existing script-spawn URL reader in `Tauri-App-Extension` instead.
- **URL-2** — not built; no one has asked for it yet.
- **URL-3** — deliberately not built; the plan gates it as enterprise-only and explicitly non-default.
- **CQ-5** — won't resolve; was contingent on URL-1, which won't build.
