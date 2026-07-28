# Implementation Plan — Fix Live Time Persistence & Adaptive Time Formatting in Desktop Agent

See [Task-Time-process-and-calculations.md](Task-Time-process-and-calculations.md) for the full architecture/data-flow reference this plan builds on.

## ⚠ Status update: Phase 1's original design is superseded — codebase already fixed this, differently and better

**Correction:** the first draft of this note said commit `fbab994` "landed mid-session." That was wrong — checked `git log`/`git branch --contains` properly this time: it's an ordinary ancestor of `main`'s HEAD, already there before this conversation started. The original Phase 1 below was written from reading `session.rs`/`controller.rs`/`lib.rs` snapshots and a `cargo check` run, without first doing a deep enough history survey (`git log` beyond the last 5-8 commits) to notice this work already existed. Same root cause as the Phase 3 correction further down — worth naming directly rather than re-telling a "the repo changed under us" story a second time. Re-audited the actual current code (`tracker.rs`, `controller.rs`, `lib.rs`, `session.rs`, `App.tsx`) before writing anything further, rather than handing back a plan to reimplement something already done. Commit `fbab994` shipped a materially different and more complete fix than the one originally proposed here.

**What's actually implemented now, confirmed by reading the live code:**

- `ActivityTracker` (`Tauri-App-Extension/src-tauri/src/agent/tracker.rs`) runs its own background loop (`loop_run`/`tick`, ticking every `SESSION_POLL_SEC` = 5s) that is now the **single source of truth** for active/idle seconds — not React state, not a frontend-fed atomic as originally planned here. It:
  - Splits each 5s tick into active vs. idle based on real mouse/keyboard input (`self.activity.idle_seconds() >= IDLE_THRESHOLD_SEC`, 60s threshold) — idle-aware, which the original Phase 1 plan didn't even account for.
  - Re-baselines from the server's known cumulative totals whenever the tracked task changes, so switching tasks mid-session doesn't restart the count at 0.
  - Pushes a `"sync"` action to the backend every `SESSION_SYNC_INTERVAL_SEC` = **20s** (`tracker.rs:276-286`) — not 120s, not 5s, not anything discussed in this plan's now-removed "Open decision" section below; already decided and live.
  - Exposes `current_task_progress() -> (Option<String>, u64, u64)` — task id, real active seconds, real idle seconds — read by the controller.
- `AgentController::stop_session()` and the shared `flush_and_stop_tracker()` (used by `stop()`, i.e. **every** quit path) both call `tracker.current_task_progress()` and send the real numbers, not `0` (`controller.rs:87-101`, `380-399`). This closes the exact quit-path data-loss gap this plan spent several turns on — via a cleaner mechanism (tracker owns the number continuously) than the one proposed here (frontend IPC feeding an atomic).
- `close_window`, the OS `CloseRequested` handler, and the tray "Quit" item all still route through `controller.stop()` (`lib.rs:58-59, 297-298, 322-324`) — confirmed unchanged, and now safe, because `stop()` flushes real numbers.
- `cargo check` passes clean as of this audit — the compile break this plan opened with no longer exists.
- No `sync_session`/`note_active_seconds` Tauri commands exist, and none are needed — the heartbeat lives entirely in the Rust tracker thread, decoupled from whether the window is open, focused, or the React tree has even mounted. The frontend's own `liveActiveSeconds` ticker still runs (1s local tick, re-synced from `session.activeSeconds` every 5s via `refresh()`) purely for the on-screen clock — it's cosmetic now, not load-bearing for persistence.

**What's genuinely still missing** — checked `fmtHours()` at `App.tsx:114-123` against this plan's proposed adaptive formatting, line by line:

```ts
function fmtHours(totalSeconds: number | null | undefined): string {
  if (totalSeconds == null || totalSeconds <= 0) return "0s";   // ✅ matches
  const total = Math.floor(totalSeconds);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) return `${h}h ${m}m`;                              // ❌ still the old behavior
  if (m > 0) return `${m}m ${s}s`;                               // ✅ matches
  return `${s}s`;                                                // ✅ matches
}
```

Three of four cases already match the proposed fix. The one gap: at `1h 0m 27s`, current code returns `1h 0m` (looks frozen for up to a minute after crossing an hour boundary with 0 minutes elapsed) instead of `1h 27s`. This is the **only remaining code change** from the original bug report.

## Phase 1 (revised) — ✅ IMPLEMENTED: fixed the one remaining `fmtHours` gap

**Note on a conflict found during implementation:** the pre-fix code carried a comment stating the hour-scale-drops-seconds behavior was intentional ("hour-scale values still just show hours/minutes since seconds aren't meaningful at that scale") — directly contradicting this diff. Flagged it and asked; user chose to apply the original spec anyway (seconds shown at the `Xh 0m` boundary), overriding that documented rationale. The comment above `fmtHours` has been updated to explain the new behavior instead of the old one, so it doesn't mislead the next reader.

**File:** `Tauri-App-Extension/src/App.tsx`, lines 110-123 (comment + function).

```diff
 function fmtHours(totalSeconds: number | null | undefined): string {
   if (totalSeconds == null || totalSeconds <= 0) return "0s";
   const total = Math.floor(totalSeconds);
   const h = Math.floor(total / 3600);
   const m = Math.floor((total % 3600) / 60);
   const s = total % 60;
-  if (h > 0) return `${h}h ${m}m`;
+  if (h > 0) return m === 0 ? `${h}h ${s}s` : `${h}h ${m}m`;
   if (m > 0) return `${m}m ${s}s`;
   return `${s}s`;
 }
```

That was the entire remaining diff. One line changed (plus the comment above it), one file. No Rust changes, no new Tauri commands, no backend changes — everything else this plan originally scoped for "Phase 1" was already live in `fbab994`.

**Verified:**
- ✅ `npm run build` in `Tauri-App-Extension` — passes clean (`tsc && vite build`, 34 modules, no errors).
- ✅ `cargo check --manifest-path src-tauri/Cargo.toml` — passes clean (regression check; this change touched no Rust code).
- Boundary cases (traced through the new code by hand, matches expected):
  - `27` → `"27s"`
  - `87` → `"1m 27s"`
  - `3627` (1h 0m 27s) → `"1h 27s"` ← the fixed case
  - `3660` (1h 1m 0s) → `"1h 1m"`
- No manual live-tracking verification needed beyond that — the persistence/quit-safety behavior this plan originally wanted to verify was already covered by whatever testing shipped with `fbab994`.

## Phase 1 — original plan (kept for record, superseded — do not implement)

<details>
<summary>Original Phase 1 design, written before <code>fbab994</code> landed. Superseded by the tracker-owned heartbeat above — collapsed here for history, not to be acted on.</summary>

The original draft (pasted by the user) got the destination right but two premises wrong, both caught by reading the actual code at the time:

1. **"Web dashboard syncs every 5s"** — false. `ACTIVITY_SESSION_SYNC_MS` (`Dashboard-Web/infrastructure/config/firestore-throttle.ts:9`) is **120s in production / 180s in dev**. The 5s figure is the web UI's *local* 1s tick rendered smoothly, and a separate *read-only* 5s session poll — neither of those write counters to the backend.
2. **Missing call site** — `cargo check` confirmed the working tree did not compile at the time:
   ```
   src\agent\controller.rs:84:41: error[E0061]: this method takes 3 arguments but 2 arguments were supplied
   src\agent\controller.rs:320:14: error[E0061]: this method takes 3 arguments but 2 arguments were supplied
   src\agent\controller.rs:339:31: error[E0061]: this method takes 3 arguments but 2 arguments were supplied
   ```

Proposed approach at the time: add a `last_active_seconds: AtomicU64` to `AgentController`, feed it from a new `note_active_seconds` Tauri command called by a 1s frontend tick, add a `sync_session` command called from a new frontend heartbeat `useEffect`, and read the atomic from the quit paths instead of hardcoding `0`. **None of this was implemented or is needed** — `fbab994` solved the same problem inside `tracker.rs` instead, with a mechanism that's idle-aware and doesn't depend on the frontend being mounted at all. Left here only so the reasoning trail isn't lost, not as a spec to build.

</details>

## Phase 2 (separate initiative) — Move canonical task data from Firestore to Postgres

Not part of Phase 1 above and not required to fix the live-time-persistence bug — tracked here because it surfaced directly from investigating it, and materially affects the same code paths. Scope this as its own pass, after Phase 1 ships.

### Why

- **Firestore is not on this VPS.** Confirmed via `Dashboard-Backend/.env.example` (`FIREBASE_PROJECT_ID`, `FIREBASE_SERVICE_ACCOUNT`) — it's Google-managed, external. Every task/time-tracking read or write today leaves the box. Postgres and Redis (the presence store behind `REDIS_URL`) are both local to the same VPS already.
- **Firestore's one differentiator — real-time push (`onSnapshot`) — isn't used for task/project data, though it exists elsewhere.** Correction after a broader sweep: `Dashboard-Backend/src/modules/compat/routes.js:389` does run `db.collection("members").onSnapshot(...)`, streamed to clients via SSE at `GET /api/members/events` (wired in `src/app/handle-request.js:202`) — a real, live listener. Dashboard-Web also has two real-time push channels unrelated to Firestore directly: `features/auth/services/presence-events-sse.ts` (SSE) and `presence-ws.ts` (WebSocket), both presence-only. None of this touches `tasks`/`projects`/`time_tracking` data — every task/project read is still a REST poll (5s/8s/120s) regardless of backing store — so the migration's core argument for *this* data still holds, but "zero `onSnapshot` hits anywhere" as originally stated here was wrong and is corrected.
- **Frontend is already fully insulated.** `Dashboard-Web` never imports the Firestore client SDK (checked — no `firebase/firestore` imports, no direct `collection()`/`doc()` calls); it only calls the backend's own REST API. This makes it a **backend-only data-layer swap** — no frontend rearchitecture needed.
- **The current design already half-agrees.** Postgres dual-write mirrors (`task_member_progress`, `timer_sessions`) already exist behind `TASK_MEMBER_PROGRESS_PG_DUAL_WRITE`, specifically because the Postgres path is faster/local — "Postgres dual-write failures are logged and never block Firestore sync." Consolidating removes this permanent reconciliation burden instead of maintaining it indefinitely.
- Firebase Auth (sign-in) is a separate product from Firestore-the-database and is out of scope — this is only about where task/time-tracking *data* lives.

### Scope — files currently touching Firestore task data

Re-audited with a dedicated Explore pass after the first grep (which matched on `collection\(["']tasks["']\)`-style literals only). That pass confirmed all 16 files below are genuine and found zero false positives, but missed 2 more files that touch `tasks` through indirection the literal-string grep couldn't see — both added below.

```
Dashboard-Backend/src/modules/tasks/task-time-tracking.js
Dashboard-Backend/src/modules/tasks/task-assignments.js
Dashboard-Backend/src/modules/schema/catalog/tasks/index.js
Dashboard-Backend/src/modules/schema/collection-ref.js
Dashboard-Backend/src/modules/schema/routes.js
Dashboard-Backend/src/modules/tasks/routes.js
Dashboard-Backend/src/modules/tasks/task-assignee-api.js
Dashboard-Backend/src/modules/tasks/task-workload-validation.js
Dashboard-Backend/src/modules/projects/services/overview-service.js
Dashboard-Backend/src/modules/members/services/member-remove-from-tree-service.js
Dashboard-Backend/src/modules/bootstrap/bootstrap-service.js
Dashboard-Backend/src/modules/dashboard/dashboard-base-loader.js
Dashboard-Backend/src/http/task-access.js
Dashboard-Backend/src/lib/firestore/task-subcollections.js
Dashboard-Backend/src/modules/activity/routes.js
Dashboard-Backend/src/bootstrap/entity-bootstrap-manifest.js
```

Missed by the original grep, found on re-audit:
- **`Dashboard-Backend/src/modules/schema/services/schema-crud.service.js`** — `validateForeignKeys()` (line 109) resolves the target collection dynamically via `foreignKeyCollectionByField[field]`, and `task_id: "tasks"` is one of those mappings (`schema/catalog/index.js:36`) — so any write carrying a `task_id` (task-assignments, task-comments, timesheets, time-entries, etc.) triggers a real `tasks` read here, invisible to a literal-string grep. Also has hardcoded `entityKey === "tasks"` business rules at lines 116, 157-165 (team/project linkage check, status-transition restrictions).
- **`Dashboard-Backend/src/modules/schema/visibility.js`** — `"tasks"` is in `filterableCollections` (line 38); lines 126-141 filter Firestore task rows by `project_id`/`assigned_to`/`created_by` on every `/api/tasks` and `/api/v1/tasks` GET. Reachable only by comparing `collectionKey === "tasks"`, never by calling `.collection("tasks")` directly.

Both need to be in scope for Phase 2's cutover (step 6) alongside the original 16 — 18 files total, not 16.

### Target schema (Postgres)

Field lists below are taken directly from the authoritative Firestore schema declaration (`Dashboard-Backend/src/modules/schema/catalog/tasks/index.js`), not reconstructed from memory — this is what actually gets written today.

- New `tasks` table — does not exist today (confirmed; `task_progress_aggregate` is a derived view, not a base table):
  ```sql
  CREATE TABLE tasks (
    id UUID PRIMARY KEY,
    project_id UUID NOT NULL,
    team_id UUID,
    title TEXT NOT NULL,
    description TEXT,
    status VARCHAR(30) NOT NULL DEFAULT 'todo',
    priority VARCHAR(20),
    order_index INT,
    duration_hours_per_day NUMERIC(6,2),
    duration_days INT,
    working_days INT,
    overtime_hours_per_day NUMERIC(6,2),
    assigned_to UUID,
    start_date TIMESTAMPTZ,
    due_date TIMESTAMPTZ,
    review_state VARCHAR(20),
    reviewed_by UUID,
    reviewed_at TIMESTAMPTZ,
    total_active_seconds BIGINT NOT NULL DEFAULT 0,
    total_idle_seconds BIGINT NOT NULL DEFAULT 0,
    aggregated_progress_percent NUMERIC(5,2),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_by UUID,
    updated_by UUID
  );
  ```
  `project_id` deliberately has no `REFERENCES projects(id)` above — **fix this now that it's possible.** The `projects` table already exists (see the Phase 3 correction note above — that migration already shipped): `Dashboard-Backend/src/lib/postgres/ensure-lookup-schema.js:403-421`. Add the FK:
  ```sql
  ALTER TABLE tasks ADD COLUMN project_id UUID NOT NULL REFERENCES projects(id);
  -- (folded into the CREATE TABLE above once written for real, not a separate step)
  ```
  `total_active_seconds`, `total_idle_seconds`, and `aggregated_progress_percent` are **not** in the formal schema catalog above (only in the earlier architecture doc, written by `aggregateTaskProgress`) — confirm during backfill whether these are genuinely stored on the Firestore doc or computed on read; if computed, drop them from this table and compute the same way in the new Postgres path instead of storing stale copies.
- New `task_assignments` table (currently Firestore-only, no Postgres equivalent):
  ```sql
  CREATE TABLE task_assignments (
    id UUID PRIMARY KEY,
    task_id UUID NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    user_id UUID NOT NULL,
    project_id UUID NOT NULL REFERENCES projects(id),
    status VARCHAR(20) NOT NULL DEFAULT 'todo',
    expected_seconds INT,
    required BOOLEAN NOT NULL DEFAULT true,
    review_state VARCHAR(20),
    reviewed_by UUID,
    reviewed_at TIMESTAMPTZ,
    review_notes TEXT,
    entered_review_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (task_id, user_id)
  );
  ```
- `task_time_tracking` (per-member counters) — extend the existing `task_member_progress` table rather than create a new one; it already covers most of the Firestore `tasks/{taskId}/time_tracking/{docId}` fields. Naming mismatch to reconcile: Firestore calls the person field `user_id`, the existing Postgres table calls it `member_id` — keep `member_id` (established Postgres convention) and map `user_id → member_id` during backfill. Columns to add:
  ```sql
  ALTER TABLE task_member_progress
    ADD COLUMN project_id UUID,
    ADD COLUMN session_id VARCHAR(128),
    ADD COLUMN review_notes TEXT;
  -- last_started_at already exists and covers Firestore's `started_at`;
  -- last_activity_at, active_seconds, idle_seconds, progress_percentage already match.
  ```
- `aggregateTaskProgress` becomes a Postgres transaction (sum `active_seconds`/`idle_seconds` across members for a task, recompute per-member `progress_percentage`, update task-level totals) instead of a Firestore read-then-write — a real transaction here is more correct than what Firestore's client-side aggregation does today, not just a port.
- Also present in the same Firestore schema catalog but out of scope for this migration (not time-tracking data, no urgency): `task-subtasks`, `task-comments`, `task-attachments`, `task-hours` subcollections. Note them so a future pass doesn't rediscover them from scratch.

### Data Migration Plan (concrete steps)

1. **Additive schema first.** Run the `CREATE TABLE tasks`, `CREATE TABLE task_assignments`, and `ALTER TABLE task_member_progress` statements above in a migration file under `Dashboard-Backend`'s existing Postgres migration mechanism. Nothing reads from these yet — pure schema stand-up, zero behavior change, safe to ship independently.
2. **Backfill script** (one-off Node.js script using the existing `firebase-admin` credentials already configured in `Dashboard-Backend`):
   - Page through every Firestore `tasks` doc (`db.collection("tasks")`), insert/upsert into Postgres `tasks`.
   - For each task, page through its `time_tracking` subcollection, upsert into `task_member_progress` (mapping `user_id → member_id` as above).
   - For each task, read matching `task_assignments` docs (top-level collection, `task_id` foreign key), upsert into the new Postgres `task_assignments` table.
   - Run in batches (Firestore's own pagination cursors), log progress and any row that fails to map cleanly (e.g. missing `task_id` reference) to a separate file for manual review rather than silently skipping.
3. **Dry-run parity check before any cutover.** For every task, compare:
   - `SUM(active_seconds)` / `SUM(idle_seconds)` across Postgres `task_member_progress` rows vs. the same sum across Firestore `time_tracking` docs for that task.
   - Row counts: Firestore `time_tracking` doc count vs. Postgres `task_member_progress` row count per task; same for `task_assignments`.
   - Any mismatch blocks cutover until explained (either a real backfill bug, or a task that changed between the read and the diff — re-run the diff, don't just accept it).
4. **Cutover, feature-flagged.** Reuse the existing `TASK_MEMBER_PROGRESS_PG_DUAL_WRITE`-style flag pattern (`Dashboard-Backend/src/config/env.js:159` — confirmed this exact flag exists, defaults `false`): add a new flag (e.g. `TASK_DATA_SOURCE=postgres`) that switches backend *reads* to the new Postgres tables, while *writes* still go to both Firestore and Postgres — the dual-write code path already exists for `task_member_progress` behind that flag (verify it's actually turned on in this deployment before relying on it, since the default is off), and needs extending to cover the newly-added `tasks`/`task_assignments` columns for the cutover window.
4.5. **Run the real desktop agent against the migrated backend — see the Tauri-App-Extension section above for exactly which fields to check.** Not optional, not covered by step 3's DB-level parity check: `task-time-tracking.js`'s response fields are hand-mapped to camelCase, not auto-converted, and `Tauri-App-Extension`'s Rust client fails silently (defaults, no error) on a missing/renamed key. Do this before step 5's soak period starts, not after.
5. **Soak period.** Run with reads on Postgres, writes on both, for a defined window (suggest at least one full billing/reporting cycle so aggregate reports get exercised against the new path) while periodically re-running the parity check from step 3 against live data, not just the initial backfill snapshot.
6. **Full cutover.** Once soak period shows no drift: stop writing to Firestore for task data, remove the Firestore-touching code from the 16 files listed above, delete the dual-write flag and the now-unused Firestore backfill script.
7. **Firebase Auth and any non-task Firestore usage stay untouched** — this migration is scoped strictly to the source-of-truth matrix in [Task-Time-process-and-calculations.md §1.1](Task-Time-process-and-calculations.md).

### Rollback plan

- Until step 6, Firestore remains fully written (dual-write) and is the instant rollback target — flip the `TASK_DATA_SOURCE` flag back to Firestore reads, no data loss, no code revert needed.
- After step 6 (Firestore paths removed), rollback requires re-adding the Firestore write paths from version control and re-running a fresh backfill in the reverse direction — treat step 6 as the actual point of no easy return, not the flag flip in step 4.

### Risks / open questions for this phase specifically

- Concurrency: Firestore transactions vs. Postgres row locks for `aggregateTaskProgress` when multiple members sync the same task simultaneously — needs an explicit locking strategy (`SELECT ... FOR UPDATE` or equivalent), not just a direct port of the current read-then-write.
- Backfill correctness for tasks with a long history (many `time_tracking` docs, many assignment transitions) — needs the dry-run diff in step 3, not just a one-shot copy.
- Confirm no other part of the codebase outside the 16 files above depends on Firestore task documents (e.g., notifications service, reporting) before removing the Firestore paths in step 6.
- Confirm whether `total_active_seconds` / `total_idle_seconds` / `aggregated_progress_percent` are actually stored fields or computed-on-read before finalizing the `tasks` DDL (see note under Target Schema above).
- **Consider the direct-cutover alternative.** The already-shipped `projects` migration (see Phase 3 correction below) deliberately skipped this dual-write/soak-period design in favor of a single-maintenance-window cutover with a Firestore read-only fallback, specifically because project data volume is low in this deployment. If task data volume is comparably low, steps 4-5 above (feature flag, dual-write, soak period) may be more machinery than needed — worth checking the real row counts before committing to the heavier pattern just because it's what got written down first.
- **The camelCase JSON response contract is hand-maintained per route handler, not automatic — this is the actual risk to the desktop agent.** Confirmed in `task-time-tracking.js`: every response field is built by explicit assignment (`activeSeconds: d.active_seconds`, etc.), not a generic snake_case→camelCase middleware. When this handler is rewritten to read Postgres instead of Firestore, every one of those manual mappings has to be preserved exactly — `Tauri-App-Extension`'s Rust client (`work.rs::fetch_task_time_tracking`) parses this exact response by JSON key (`activeSeconds`, `idleSeconds`, `taskStatus`, `timerAllowance.workedTodayOnTaskSeconds`, etc.) with no fallback to snake_case, and fails **silently** on a missing/renamed key — `.and_then(|v| v.as_u64())` just returns `None`/defaults to `0`, no error, no crash, just wrong numbers shown to the user. DB-level parity checks (step 3 above) cannot catch this class of bug at all, since they compare data, not response shape. Add an explicit step: after cutover, run the real desktop agent against the migrated backend and confirm `TaskTimeTracking` fields populate correctly, not just that the underlying numbers match.

### Tauri-App-Extension — does this phase need agent-side changes?

Verified directly against the agent's actual HTTP client code (`work.rs`, `session.rs`, `types.rs`), not assumed. **No Rust/frontend changes needed** — the agent is a pure REST client, insulated from the storage engine by the same JSON contract Dashboard-Web relies on:

| Agent call | Endpoint | Backend file (Phase 2 scope?) |
|---|---|---|
| `fetch_viewer_member_id` | `GET /api/activity/scope` | `activity/routes.js` — yes, in the 18-file list |
| `fetch_viewer_projects` | `GET /api/projects` | `projects/routes.js` — **already Postgres**, confirmed live (`listProjectsPg`/`getProjectPg`) |
| `fetch_assigned_tasks` | `GET /api/tasks?assigned_to=...` | `tasks/routes.js` — yes, in the 18-file list |
| `fetch_task_time_tracking` | `GET /api/tasks/:id/time-tracking` | `task-time-tracking.js` — yes, in the 18-file list (the highest-risk one, see above) |
| `post_session_action`/`fetch_session` | `GET`/`POST /api/activity/session` | `activity/routes.js` — yes, in the 18-file list |
| `fetch_member_limits`, `fetch_member_profile` | `/api/activity/limits`, `/api/members/current` | Members stay in Firestore (Phase 4.9) — untouched by any phase here |

Three of the agent's six calls are served by files Phase 2 is about to rewrite. As long as those handlers keep returning the exact same camelCase keys after the Firestore→Postgres swap (the risk called out above), the agent needs zero code changes — it already survived the `projects` migration with zero changes for the same reason, which is direct evidence this insulation actually holds in practice here, not just in theory.

**One pre-existing, non-blocking inconsistency found along the way:** the already-migrated `GET /api/projects` list handler (`projects/routes.js:477-488`) returns raw Postgres rows (`sendJson(res, origin, 200, { success: true, data: rows })`) with no camelCase remapping — unlike `task-time-tracking.js`'s handler, which does remap by hand. This works today only because the two fields the agent actually reads from this endpoint (`id`, `name`) are single words with no casing difference. If the agent's project dropdown is ever extended to show another field from this response — `client_id`, `disable_activity`, `allow_project_tracking` — it would arrive as raw snake_case and silently fail to parse under the same `.and_then(|v| v.as_str())` pattern used everywhere else in `work.rs`. Not a bug today, a landmine for whoever adds a field later without knowing this endpoint is the one that skips the remapping step every other handler does.

**Fix (standalone, cheap, doesn't depend on Phase 2 — do this regardless):**
```js
// Dashboard-Backend/src/modules/projects/routes.js, GET /api/projects handler
function toProjectJson(row) {
  return {
    id: row.id,
    name: row.name,
    status: row.status,
    billable: row.billable,
    disableActivity: row.disable_activity,
    allowProjectTracking: row.allow_project_tracking,
    disableIdleTime: row.disable_idle_time,
    clientId: row.client_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
// ...
sendJson(res, origin, 200, { success: true, data: rows.map(toProjectJson) });
```
Matches the exact hand-mapping pattern `task-time-tracking.js` already uses — no new convention introduced, just applying the existing one consistently to the one handler that currently skips it.

**Verification step, explicit (not currently a numbered step in Phase 2's Data Migration Plan above — add it there as step 4.5, between "Cutover" and "Soak period"):** after Phase 2's cutover flips `tasks`/`task_assignments` reads to Postgres, run the real `Tauri-App-Extension` desktop agent (not just the DB-level parity check) against the migrated backend and confirm, field by field: `fetch_assigned_tasks` still returns non-empty titles/status/projectId, and `fetch_task_time_tracking` still populates `activeSeconds`, `idleSeconds`, `taskStatus`, `estimatedSeconds`, `overtimeSeconds`, `workingDays`, `hoursPerDay`, `overtimeHoursPerDay`, `progressPercent`, and all five `timerAllowance.*` fields — not just that they're present, but that they show the same values the pre-cutover Firestore-backed response showed for the same task. A silently-dropped or renamed key here shows up as `0`/empty in the desktop agent's UI, not as an error anywhere — this is the only check in the plan that would actually catch that.

## Phase 3 — Projects & Tasks schema/query performance — ⚠ the Projects half already shipped, before this plan existed

**Correction, found while answering a Tauri-App-Extension question and digging deeper into git history than the earlier passes did:** the entire "migrate `projects` to Postgres" half of this ADR is not a proposal — it's already implemented, already merged to `main`, and predates this conversation. `PROPOSAL-Projects-Migration-to-PostgreSQL.md` (repo root) is a real, more thorough design doc than the ADR below — it independently found the same overview-service.js anti-pattern, plus a genuinely serious pre-existing bug this ADR never caught (the Project table/overview UI cannot distinguish hourly from dollar budgets, and "spent" was fabricated — `0` or a demo percentage, never a real number). Commits `92ef3a8` (the migration itself — schema, service layer, backfill script, and every one of the 18 files that read these Firestore collections directly, repointed) and `a303dcb` (backfill normalization fix) landed this. Verified directly against the live file: `overview-service.js` now runs `pgQuery("SELECT id, status, name FROM projects LIMIT 200")` etc. — only `tasks` is still a Firestore read there, exactly matching that proposal's explicit scope note: *"Tasks migration — tasks are a follow-up candidate, evaluated separately after projects are stable in PG."*

**What this means for this ADR:** the "Decision" and "Target schema additions" below for `projects`/`project_members`/`project_budgets`/`project_member_limits` are moot — don't build them, a better version already exists (schema at `Dashboard-Backend/src/lib/postgres/ensure-lookup-schema.js:403-503`, real FKs to `projects(id)` already in place on `project_members`/`project_budgets`/`project_member_limits`/`client_projects`/`team_projects`). Kept below, collapsed, for the reasoning trail only — same treatment as the old Phase 1. **The Context section's finding that this anti-pattern recurs in 9+ other files (dashboard-base-loader.js, bootstrap-warm-service.js, client-service.js, hierarchy scans, etc.) is still real and still unaddressed** — the shipped migration only covered projects' own aggregate, not the dashboard/bootstrap/hierarchy instances found on re-audit. That work (labeled Phase 3.5 in the Action Items below) is still open.

**One item from the real migration worth folding into Phase 2 (tasks, still pending):** the shipped proposal deliberately chose a **direct-cutover strategy** (backfill once, single maintenance window, Firestore read-only fallback for N days) over the dual-write/soak-period/parity-cron pattern, specifically because *"current project data volume is low... running weeks of dual-write, drift-checking, and parallel-output comparison to migrate a small dataset is solving a problem that doesn't exist here."* Phase 2's Data Migration Plan below still proposes the heavier dual-write pattern. Worth checking whether the same "data volume is low" reasoning applies to tasks before committing to the more expensive approach — if it does, Phase 2 should switch to the same direct-cutover pattern already proven in this exact codebase, rather than inventing a different, more complex one.

<details>
<summary>Original ADR text, written before the existing migration was found — Projects-related parts superseded, kept for the reasoning trail.</summary>

### ADR-1: Consolidate Projects/Tasks overview aggregation into indexed SQL

**Status:** Proposed
**Date:** 2026-07-28
**Deciders:** whoever owns `Dashboard-Backend` data layer

#### Context

Grepped the actual query patterns against `tasks`/`projects` in Firestore today (not assumed — read `overview-service.js`, `task-assignments.js`, `task-assignee-api.js`, `task-workload-validation.js`, `firestore.indexes.json`). Found:

- `getOverviewCore` (`Dashboard-Backend/src/modules/projects/services/overview-service.js:48-56`) issues **5 parallel full-collection reads** — `projects` (200 cap), `project_budgets` (200), `project_members` (2000), `project_member_limits` (200), `tasks` (500) — then joins and aggregates all of it in Node with plain `Map`s. `getOverviewPanels` does the same again with 6 more collection reads.
- Every one of those `.limit(N)` calls is a **hard ceiling baked into application code**, not pagination — once an org has more than 500 tasks or 2000 project-member rows, the overview silently under-counts rather than erroring or paginating.
- `task-assignments.js:775` — `db.collectionGroup("time_tracking").limit(500).get()` — a reconciliation query capped at 500 rows **across every task and every member in the entire system**. This is a live correctness bug today, independent of any migration timeline: past 500 total time-tracking docs, this silently drops rows.
- `task-assignments.js:462` — `.where("user_id", "in", chunk)` requires manually chunking the ID list because Firestore's `in` operator caps arity; this whole chunking layer disappears with `WHERE user_id = ANY($1::uuid[])` in Postgres, no cap.
- `firestore.indexes.json` already declares the composite indexes `tasks(assigned_to, status)`, `task_assignments(task_id, user_id)`, `project_members(member_id, project_id)` **and** `project_members(project_id, member_id)` (both directions) — i.e., Firestore itself needed hand-declared composite indexes for exactly the access patterns a relational schema would index natively, which is good evidence for what the Postgres indexes below need to cover.

**This pattern is not isolated to `overview-service.js`/`task-assignments.js` — re-audited the full backend and it's systemic.** At least 9 more files run the identical shape (N parallel capped `.get()` reads joined via in-app `Map`s), some higher-traffic than the overview endpoint itself:
  - `dashboard-base-loader.js:71-92` / `general-dashboard-service.js:391-482` — the **main dashboard's** own aggregate (4 parallel reads, `LIMIT 300/300/3000` + Firestore `.limit(800)`) — arguably more load-bearing than `overview-service.js`.
  - `bootstrap/bootstrap-warm-service.js:84-104` — 9 parallel reads each capped at `LIST_LIMIT=200`.
  - `clients/services/client-service.js:371-438` (`listClientsEnriched`) — 4 parallel reads (`.limit(500)`, `.limit(1000)` ×2, `LIMIT 2000`).
  - `member-relationships/routes.js:168-172` — `.limit(1200)`/`.limit(2400)`/`.limit(100)` for the org visual-tree.
  - `hierarchy/hierarchy-repair.js:45-48` and `hierarchy/hierarchy-audit.js:22-25` — near-duplicate `.limit(2000)`/`.limit(2000)`-`.limit(4000)` logic, same anti-pattern implemented twice.
  - `members/services/generate-employee-id.service.js:138-142` — a third near-copy of the hierarchy-scan pattern.
  - `clients/routes.js:72-76` and `member-onboarding/routes.js:88-90` — same shape, `.limit(500)`/`.limit(400)`.

  Plus the manual `.where(field, "in", chunk)` pattern (cited above at `task-assignments.js:462`) recurs in `member-relationships/service.js:178`, `hierarchy/transfer-request.service.js:98`, `schema/visibility.js:200`, and `members/services/member-list-enrichment.js:57`.

  The `collectionGroup(...).limit()` silent-truncation bug (`task-assignments.js:775`) does appear to be genuinely unique to that one query — confirmed via a repo-wide `collectionGroup` search.

  **This changes the framing, not the immediate scope.** This ADR's Decision below stays scoped to Projects/Tasks — don't silently balloon a two-table migration into an eleven-file rewrite. But Projects/Tasks should be treated explicitly as the **pilot** for this pattern, not a one-off: the dashboard/bootstrap/clients/hierarchy instances are real, comparable-or-larger problems and belong in a tracked Phase 3.5 once this pilot proves out the approach (see Action Items).

#### Decision

Extend the Phase 2 Postgres migration to include `projects`, `project_members`, `project_budgets`, `project_member_limits` (currently Firestore-only, same treatment `tasks`/`task_assignments` already got in Phase 2), add composite indexes matching the access patterns above, and replace `getOverviewCore`/`getOverviewPanels`'s multi-read-then-JS-join with single indexed SQL queries using `JOIN` + `GROUP BY`.

#### Options Considered

##### Option A: Keep Firestore, raise `.limit()` caps, add real cursor pagination
| Dimension | Assessment |
|---|---|
| Complexity | Low |
| Cost | Low effort, but doesn't reduce Firestore read volume/cost |
| Scalability | Still 5-11 external round-trips per overview request, still JS-side aggregation |
| Team familiarity | High — no new schema work |

**Pros:** cheapest, no migration risk.
**Cons:** doesn't fix the external-network-hop cost (Phase 2's core rationale), doesn't fix `task-assignments.js:775`'s silent-truncation *class* of bug elsewhere, just moves the ceiling further out.

##### Option B: Migrate `projects`+`tasks` to Postgres (this ADR)
| Dimension | Assessment |
|---|---|
| Complexity | Medium — reuses Phase 2's backfill/parity/cutover machinery, just more tables |
| Cost | One-time migration effort; ongoing cost drops (no external Firestore round-trips for these reads) |
| Scalability | One indexed query replaces 5-11 reads; no `.limit()` ceiling, aggregation pushed to the DB |
| Team familiarity | Same team already doing Phase 2; incremental, not new |

**Pros:** fixes the problem at the source, consistent with the Phase 2 decision already made, no new source of truth introduced.
**Cons:** overview endpoints can't cut over ahead of Phase 2's own cutover step for these tables — sequencing dependency, not extra work.

##### Option C: Postgres materialized summary table for the overview endpoint only, Firestore stays source of truth
| Dimension | Assessment |
|---|---|
| Complexity | Low-Medium |
| Cost | Cheap short-term |
| Scalability | Fixes overview specifically, does nothing for `task-assignments.js:775` or the `in`-chunking pattern elsewhere |
| Team familiarity | New concept (refresh job, staleness window) |

**Pros:** smallest change if only the dashboard-landing-page numbers matter right now.
**Cons:** introduces a second source of truth that can visibly disagree with live Firestore data (staleness window), and is a dead-end fix — doesn't address the same anti-pattern anywhere else it appears.

#### Trade-off Analysis

Option A doesn't touch the actual cost driver (external DB + JS-side aggregation) and leaves `task-assignments.js:775` broken. Option C is a local patch that adds staleness and doesn't generalize. Option B costs more up front but is the only one consistent with the direction already decided in Phase 2, fixes the problem class (not just one endpoint), and reuses machinery this plan already built rather than starting a separate effort.

#### Consequences

- Extends Phase 2's schema stand-up step with `projects`, `project_members`, `project_budgets`, `project_member_limits` DDL (below).
- `getOverviewCore`/`getOverviewPanels` get rewritten as SQL once these tables exist and pass Phase 2's parity check for them — sequenced after, not before.
- Removing the arbitrary `.limit(2000)`-style ceilings becomes safe, since a SQL aggregate has no such ceiling by construction.
- `task-assignments.js:775`'s silent-truncation bug should be treated as its own fix, on its own timeline — it doesn't need to wait for this migration (see Action Items).

#### Action Items

1. [ ] Add `projects`/`project_members`/`project_budgets`/`project_member_limits` DDL (below) to Phase 2's schema stand-up step.
2. [ ] Add the composite indexes below, matching the access patterns Firestore's own `firestore.indexes.json` already had to declare.
3. [ ] Replace `getOverviewCore`/`getOverviewPanels` with the SQL query below once Phase 2 cutover completes for these tables.
4. [ ] Fix `task-assignments.js:775`'s `collectionGroup("time_tracking").limit(500)` reconciliation query independently and sooner — it's a live correctness bug, not a performance nice-to-have, and doesn't depend on this migration.
5. [ ] After this pilot ships, open a tracked "Phase 3.5" scoping the same fix for the 9+ other files found on re-audit (listed in Context above) — starting with `dashboard-base-loader.js`/`general-dashboard-service.js`, since the main dashboard aggregate is plausibly higher-traffic than the overview endpoint this ADR fixes first.

### Target schema additions (Postgres)

Field lists taken from `Dashboard-Backend/src/modules/schema/catalog/projects/index.js` — the same authoritative source used for the Phase 2 `tasks` DDL.

```sql
CREATE TABLE projects (
  id                       UUID PRIMARY KEY,
  name                     TEXT NOT NULL,
  billable                 BOOLEAN NOT NULL DEFAULT false,
  disable_activity         BOOLEAN NOT NULL DEFAULT false,
  allow_project_tracking   BOOLEAN NOT NULL DEFAULT true,
  disable_idle_time        BOOLEAN NOT NULL DEFAULT false,
  client_id                UUID,
  managers_notes           TEXT,
  users_notes              TEXT,
  viewers_notes            TEXT,
  status                   VARCHAR(20) NOT NULL DEFAULT 'active',
  created_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by               UUID,
  updated_by               UUID,
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
  archived_by              UUID,
  archived_at              TIMESTAMPTZ
);
CREATE INDEX idx_projects_status    ON projects (status);
CREATE INDEX idx_projects_client_id ON projects (client_id) WHERE client_id IS NOT NULL;

CREATE TABLE project_members (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id     UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  member_id      UUID NOT NULL,
  project_role   VARCHAR(40),
  assigned_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  assigned_by    UUID,
  updated_by     UUID,
  UNIQUE (project_id, member_id)
);
-- Both directions are genuinely queried today — firestore.indexes.json declares
-- (member_id, project_id) AND (project_id, member_id) separately. The UNIQUE
-- constraint above covers project_id-first lookups as a btree prefix; add the
-- reverse explicitly since Postgres won't use it efficiently for member_id-only.
CREATE INDEX idx_project_members_member ON project_members (member_id, project_id);

CREATE TABLE project_budgets (
  id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id                  UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  type                        VARCHAR(30),
  based_on                    VARCHAR(30),
  cost                        NUMERIC(12,2),
  notify_project_members      BOOLEAN NOT NULL DEFAULT false,
  notify_at_pct               NUMERIC(5,2),
  who_to_notify               VARCHAR(30),
  stop_timers_when_reached    BOOLEAN NOT NULL DEFAULT false,
  stop_timers_at_pct          NUMERIC(5,2),
  resets                      VARCHAR(20),
  start_date                  DATE,
  include_non_billable_time   BOOLEAN NOT NULL DEFAULT true,
  created_at                  TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by                  UUID,
  updated_by                  UUID
);
CREATE INDEX idx_project_budgets_project ON project_budgets (project_id);
-- NOT a UNIQUE index: existing read sites (project-budget-from-clients.js) always
-- .limit(1), which suggests a single-active-budget assumption, but `resets` +
-- `start_date` also suggest budgets could legitimately have a history over time.
-- Confirm the real intent before enforcing uniqueness — don't guess it into the DDL.

CREATE TABLE project_member_limits (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id               UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  member_id                UUID NOT NULL,
  type                     VARCHAR(30),
  based_on                 VARCHAR(30),
  cost                     NUMERIC(12,2),
  resets                   VARCHAR(20),
  start_date               DATE,
  notify_at_pct            NUMERIC(5,2),
  notify_project_members   BOOLEAN NOT NULL DEFAULT false,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by               UUID,
  updated_by               UUID,
  UNIQUE (project_id, member_id)
);
```

Additions to the Phase 2 `tasks`/`task_assignments` DDL, to match the access patterns actually found in `tasks/routes.js`, `task-assignee-api.js`, `task-workload-validation.js`:

```sql
CREATE INDEX idx_tasks_assigned_status ON tasks (assigned_to, status);
CREATE INDEX idx_tasks_project_status  ON tasks (project_id, status);

CREATE INDEX idx_task_assignments_user    ON task_assignments (user_id);
CREATE INDEX idx_task_assignments_project ON task_assignments (project_id);
```

### Optimized replacement query for `getOverviewCore`

```sql
-- Project overview summary: replaces 5 parallel Firestore collection reads
-- (hardcoded 200/500/2000 row caps) + in-app Map-based joins in
-- overview-service.js:getOverviewCore. No arbitrary truncation ceiling —
-- aggregation happens in Postgres across the full table, in one round trip.
WITH task_counts AS (
  SELECT
    project_id,
    COUNT(*)                                 AS tasks_total,
    COUNT(*) FILTER (WHERE status = 'done')  AS tasks_done
  FROM tasks
  GROUP BY project_id
),
member_counts AS (
  SELECT project_id, COUNT(*) AS member_count
  FROM project_members
  GROUP BY project_id
),
latest_budget AS (
  -- DISTINCT ON guards against multiple historical budget rows per project
  -- (see the note on project_budgets above) silently fanning out the join.
  SELECT DISTINCT ON (project_id)
    project_id,
    cost AS budget_total,
    notify_at_pct
  FROM project_budgets
  ORDER BY project_id, created_at DESC
),
member_limits AS (
  SELECT project_id, cost AS member_limit_cost
  FROM project_member_limits
)
SELECT
  p.id,
  p.name,
  p.status,
  COALESCE(tc.tasks_total, 0)  AS tasks_total,
  COALESCE(tc.tasks_done, 0)   AS tasks_done,
  COALESCE(mc.member_count, 0) AS member_count,
  lb.budget_total,
  ml.member_limit_cost
FROM projects p
LEFT JOIN task_counts   tc ON tc.project_id = p.id
LEFT JOIN member_counts mc ON mc.project_id = p.id
LEFT JOIN latest_budget lb ON lb.project_id = p.id
LEFT JOIN member_limits ml ON ml.project_id = p.id
WHERE p.id = ANY($1::uuid[])  -- replaces the allowedProjectIds Set<string> filter; pass NULL/omit for "all"
ORDER BY p.created_at;
```

`health` (on_track/at_risk/stalled, `calculateHealth` in `overview-service.js`) and `budgetSpent`-from-percent stay as cheap derived logic in the API layer — they're pure per-row math on already-aggregated numbers, not a query cost, so there's no reason to push them into SQL too.

### How to verify

- Run the replacement query against the Phase 2 backfilled data; diff `tasks_total`/`tasks_done`/`member_count`/`budget_total` per project against `getOverviewCore`'s current JS-computed output for every project, not just a sample.
- Load-test the overview endpoint before/after on an org sized past today's `.limit()` ceilings (>500 tasks, >2000 project-member rows) — this is the scenario the old code silently mishandled and the new one shouldn't.
- Confirm `task-assignments.js:775`'s fix (Action Item 4) independently — count rows in `time_tracking`/`task_member_progress` before and after, confirm nothing past row 500 was being dropped.

</details>

## Phase 4 (separate initiative) — Post-migration schema hardening

Assumes Phase 2 and Phase 3 have already shipped and the task/project domain is fully relational. These are improvements to the *resulting* schema — normalization, correctness, and resource-fit for this specific VPS — not migration mechanics. Each item below is grounded in the actual current code (schema.sql, live query implementations), not speculative.

### 4.1 Primary key strategy — UUIDv4 → UUIDv7

Every table uses `gen_random_uuid()` (UUIDv4) as PK. Random insertion order means every insert can land anywhere in the btree, causing page splits and index bloat — a real, compounding write cost on a 2-vCPU KVM2 box, worst on the highest-write tables (`activity_app_logs`, `task_member_progress`).

**Fix:** use UUIDv7 (time-sortable, same 128-bit external shape — no application-facing change, no API contract change) instead of `gen_random_uuid()`. Postgres 17+ has native `uuidv7()`; earlier versions need `pg_uuidv7` extension or an application-side generator.

```sql
-- Postgres 17+:
ALTER TABLE task_member_progress ALTER COLUMN id SET DEFAULT uuidv7();
-- Repeat for other high-write tables once confirmed available; on <17, generate
-- UUIDv7 in the application layer instead (e.g. the `uuidv7` npm package) and
-- pass it explicitly rather than relying on a DB-side DEFAULT.
```

Apply to `task_assignments` (genuinely new table from Phase 2) from day one rather than retrofitting later.

### 4.2 Collapse `activity_sessions` and `timer_sessions`

Both represent the same underlying fact — a start/stop window with `started_at`, `ended_at`, `active_seconds`, `idle_seconds` — split into two tables because `activity_sessions` also carries `status` (active/idle/stopped) for "the current one." Every start/stop already has to touch both; that's the same dual-write-drift risk this plan already found and fixed once (Firestore/Postgres), self-inflicted a second time within Postgres alone.

**Fix:** one table. A row with `ended_at IS NULL` is the live session; closed rows are history — no second table needed.

```sql
-- Illustrative target shape (actual migration would fold timer_sessions'
-- `source` column in and drop timer_sessions):
ALTER TABLE activity_sessions ADD COLUMN source TEXT NOT NULL DEFAULT 'web'
  CHECK (source IN ('web', 'desktop_agent'));
-- Backfill timer_sessions rows into activity_sessions as closed history rows,
-- then drop timer_sessions once every read site (`idx_ts_task_member`,
-- `idx_ts_open`) is repointed at activity_sessions.
```

### 4.3 Collapse `task_member_progress.accumulated_work_time` into `active_seconds`

`accumulated_work_time` exists only to be `GREATEST(existing, active_seconds)` on every sync — a manual ratchet against the counter going backwards, maintained as a second column instead of a constraint on the first.

**Fix:** drop `accumulated_work_time`; enforce monotonicity on `active_seconds` directly, or rely on the tracker's already-correct sync path (see Status Update at the top — `tracker.rs` sends real, monotonically-ticked values today) making the ratchet unnecessary:

```sql
ALTER TABLE task_member_progress DROP COLUMN accumulated_work_time;
-- If a defensive floor is still wanted despite the tracker already sending correct values:
ALTER TABLE task_member_progress ADD CONSTRAINT chk_active_seconds_monotonic
  CHECK (active_seconds >= 0);  -- combine with an UPDATE trigger comparing OLD/NEW if a hard ratchet is required
```

### 4.4 Unify `member_id` vs `user_id` naming

`task_member_progress`, `activity_sessions`, `project_members` all use `member_id` already (confirmed in `schema.sql`). The one outlier is the Phase 2 `task_assignments` DDL, which keeps Firestore's `user_id` naming for the identical person reference (Phase 2 deliberately did **not** create a separate `task_time_tracking` table — it extends `task_member_progress`, which already uses `member_id`, so this is a single-table fix, not a multi-table rename). Post-migration is the moment to standardize before every JOIN across task/session tables has to remember which table uses which name.

**Fix:** rename `task_assignments.user_id` to `member_id` (majority convention already in Postgres):

```sql
ALTER TABLE task_assignments RENAME COLUMN user_id TO member_id;
-- Update the Phase 3 composite index accordingly:
--   idx_task_assignments_user → (member_id)
```

### 4.5 Fix or drop the dead `task_status` enum

`CREATE TYPE task_status AS ENUM ('to_do', 'in_progress', 'in_review', 'completed')` is declared in `schema.sql`/`ensure-lookup-schema.js` and used by **zero columns** anywhere (grepped the full backend — only its own declaration). It also doesn't match real status values seen in code: `fetch_assigned_tasks` excludes `done`, `cancelled`, `canceled`, `archived` — none of which exist in this enum — and uses `todo`, not `to_do`.

**Fix:** either wire it up correctly and use it on `tasks.status`, corrected to match real values —
```sql
DROP TYPE IF EXISTS task_status;
CREATE TYPE task_status AS ENUM ('todo', 'in_progress', 'in_review', 'done', 'cancelled', 'archived');
ALTER TABLE tasks ALTER COLUMN status TYPE task_status USING status::task_status;
```
— or drop it entirely and keep `tasks.status` as `VARCHAR`. A stale, mismatched enum sitting unused in the schema is worse than a plain string column; don't leave it as-is.

### 4.6 Real bug: daily/weekly allowance caps don't respect midnight

`sumPgMemberActiveSeconds` (`Dashboard-Backend/src/lib/postgres/activity-events-postgres.service.js:371-375`) sums a session's **entire** `active_seconds` when `started_at` falls within the requested day/week range:
```sql
WHERE member_id = $1 AND started_at >= $2 AND started_at <= $3
```
A session started at 11:50pm that's still open (or synced) at 1am gets **all** its accumulated seconds attributed to the day it started — none to the next. `workedTodaySeconds`/`workedWeekSeconds` (which directly gate the timer allowance — §3 of the architecture doc) are wrong at every midnight boundary a session crosses. This is a live correctness bug, not a hypothetical.

**Fix:** a `daily_member_active_seconds` rollup table, incremented by the sync/heartbeat handler with seconds actually attributed to the calendar day they were worked (split at midnight), instead of summing raw session rows by session start time:
```sql
CREATE TABLE daily_member_active_seconds (
  member_id      UUID NOT NULL,
  day            DATE NOT NULL,
  active_seconds BIGINT NOT NULL DEFAULT 0 CHECK (active_seconds >= 0),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (member_id, day)
);
CREATE INDEX idx_daily_active_member_day ON daily_member_active_seconds (member_id, day DESC);
```
The sync handler upserts into this table with the delta since the last sync, attributed to `now()::date` at sync time — the delta approach sidesteps the midnight-split problem entirely, since each sync only ever attributes seconds to the single day it actually ran in.

### 4.7 Screenshot storage is a real disk risk on this specific box

Confirmed `insertActivityScreenshot` (`activity-events-postgres.service.js:57-76`) writes `row.imageData` directly into `activity_screenshots.image_data BYTEA` — this is the live insert path, not a fallback. Your VPS panel showed **25GB/100GB already used**. Inline binary screenshots bloat both the live database and every backup of it, on a box with a fixed, fairly small disk ceiling.

**Fix:** default to `screenshot_url` (object storage / filesystem path) over inline `image_data`, and add a retention job — none exists today:
```sql
-- Illustrative retention job (run on a schedule, e.g. nightly):
DELETE FROM activity_screenshots WHERE captured_at < now() - INTERVAL '30 days';
DELETE FROM activity_app_logs    WHERE started_at  < now() - INTERVAL '90 days';
DELETE FROM activity_url_logs    WHERE visited_at   < now() - INTERVAL '90 days';
```
Retention windows are a product decision (compliance/audit needs may require longer) — the numbers above are illustrative, not a recommendation of exactly 30/90 days.

### 4.8 Trigger-maintained rollups instead of live `GROUP BY`

`task_progress_aggregate` (and the Phase 3 overview query) recompute `SUM(active_seconds)` across all members on every read. Read cadence (5s/8s polling, potentially many viewers per task) vastly exceeds write cadence (one sync per `SESSION_SYNC_INTERVAL_SEC` = 20s per active tracker — see Status Update at the top). A trigger-maintained `tasks.total_active_seconds` (already a stored column in the Phase 2 DDL) is cheaper than recomputing the sum on every read, and doesn't depend on application code (`aggregateTaskProgress()`) always remembering to call it — the same class of bug this session already found once (the original, pre-`fbab994` quit-path gap) and would rather not reintroduce at the database layer.

```sql
CREATE OR REPLACE FUNCTION recompute_task_totals() RETURNS TRIGGER AS $$
BEGIN
  UPDATE tasks SET
    total_active_seconds = (SELECT COALESCE(SUM(active_seconds), 0) FROM task_member_progress WHERE task_id = COALESCE(NEW.task_id, OLD.task_id)),
    total_idle_seconds   = (SELECT COALESCE(SUM(idle_seconds), 0)   FROM task_member_progress WHERE task_id = COALESCE(NEW.task_id, OLD.task_id)),
    updated_at = now()
  WHERE id = COALESCE(NEW.task_id, OLD.task_id);
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_recompute_task_totals ON task_member_progress;
CREATE TRIGGER trg_recompute_task_totals
  AFTER INSERT OR UPDATE OR DELETE ON task_member_progress
  FOR EACH ROW EXECUTE FUNCTION recompute_task_totals();
```

### 4.9 No `member_id` has a real foreign key anywhere

`schema.sql` states outright: *"members stay in Firestore."* So even fully migrated, `member_id`/`user_id` across every task/project/session table remains an unenforceable soft reference — Postgres can't catch a row pointing at a deleted or nonexistent member. Not proposing members also migrate (materially bigger scope than this plan) — naming it explicitly as a standing integrity gap rather than leaving it silently assumed away. Worth its own future ADR if data integrity issues from orphaned member references ever surface.

### 4.10 Connection pooling — worth auditing, not yet confirmed as a problem

Multiple Node services (auth, dashboard-backend, notification, web-backend — per the resource panel) likely each run against the same Postgres instance. If each opens its own independent connection pool, a 2-vCPU box can hit `max_connections` pressure under load. This pass didn't verify actual pool sizes or `max_connections` — flagged as a check to run, with PgBouncer as the standard fix if it turns out to be real:
```sql
SHOW max_connections;
SELECT count(*) FROM pg_stat_activity;  -- run under normal load to see actual usage vs. the ceiling
```

### 4.11 `created_by`/`updated_by`/`approved_by` silently mix two incompatible ID spaces — the most serious item on this list

Found on re-audit, not in the original pass. Same column names (`created_by`, `updated_by`, `approved_by`) hold **two different kinds of identifier** depending on the table, with no type-level guard against mixing them up:
- `VARCHAR(255)` holding raw **Firebase Auth uids** on `time_entries`, `roles`, `lookup_tables`, `employment`, `timesheets` — explicitly because, per the comment at `ensure-lookup-schema.js:123-132`, *"Firebase Auth uids ... never fit the UUID type."*
- `UUID` holding generated **`memberId`s** on `projects`/`project_members`/`project_budgets` (`schema.sql:462-464`), populated from `viewer.memberId` in `modules/projects/routes.js:507,554`.

This is worse than the `user_id`/`member_id` naming mismatch (4.4) because that one is just a naming inconsistency — this one is two genuinely different identifier spaces sharing identical column names across the schema, with nothing stopping a future query from joining `projects.created_by` against `time_entries.created_by` and silently matching zero rows or, worse, coincidentally matching the wrong entity if uid/memberId formats ever overlap. Also found in the same family: `notifications.recipient_id` / `activity_alert_log.recipient_ids` don't follow the schema's own `member_id` convention, and `project_budgets.who_to_notify` is `VARCHAR(255)` rather than a proper actor reference.

**Fix:** decide one canonical actor-id space per table family before Phase 2's migration adds more tables to the pile. Either standardize on `memberId` everywhere (requires resolving Firebase uid → memberId at write time on the Firebase-uid tables) or keep both but rename so the type difference is visible in the column name (`created_by_uid` vs `created_by_member_id`) rather than hidden behind an identical name with a silently different meaning.

### 4.12 Redundant duplicate indexes — free, cheap fix

Three tables declare a `UNIQUE` constraint (which Postgres already backs with an index) *and* a separate explicit index on the exact same single column — two indexes maintained on every write for zero query benefit:
```sql
-- roles.name:        UNIQUE (schema.sql:86) + idx_roles_name (schema.sql:94)
-- time_settings.member_id: UNIQUE (schema.sql:157) + idx_time_settings_member (schema.sql:170)
-- employment.member_id:    UNIQUE (schema.sql:174) + idx_employment_member (schema.sql:199)
DROP INDEX IF EXISTS idx_roles_name;
DROP INDEX IF EXISTS idx_time_settings_member;
DROP INDEX IF EXISTS idx_employment_member;
```
Cheaper than the UUIDv7 change (4.1) and has zero behavior change — batch it into the same migration pass.

### 4.13 A second, distinct midnight/timezone bug — independent of 4.6

`sumPgMemberActiveSeconds` (4.6) isn't the only date-boundary issue. `fetchPgScreenshots`/`fetchPgAppLogs`/`fetchPgUrlLogs` filter by day using `captured_at::date = $N::date` / `started_at::date` / `visited_at::date` (`activity-events-postgres.service.js:192,220,249`). The `::date` cast resolves in the Postgres **session timezone**, and `getPostgresPool()` (`client.js`) never sets one explicitly — so a screenshot/app-log/url-log captured near local midnight can land on a different calendar day than the `dayParam` the UI actually requested (`modules/activity/routes.js:678`), depending on whatever timezone the Postgres session defaults to (server default, likely UTC, not the member's local day).

**Fix:** either explicitly set/pass a timezone on these queries (`AT TIME ZONE`) matching the member's actual working timezone, or store/filter by a pre-computed local-date column instead of casting a `TIMESTAMPTZ` at query time. Same root cause class as 4.6 (server-side day-boundary math not accounting for the boundary correctly) but a separate bug in separate code — fix both, not just one.

### 4.14 Dead column: `activity_screenshots.has_image`

`has_image` is hardcoded to the literal `true` on every insert (`activity-events-postgres.service.js:66`), but read downstream as `d.has_image !== false` (`modules/activity/routes.js:753`) — implying a `false` branch the write path can never actually produce. Either the column is meant to support a future no-image capture mode that was never wired to the writer, or it's dead weight. Confirm intent before Phase 2/3 touch this table further; if dead, drop it rather than migrate it forward.

### 4.15 `activity_sessions.task_id` has no index despite being filtered on

`sumPgMemberActiveSeconds` also filters `activity_sessions` on `task_id` (`activity-events-postgres.service.js:380`) for the `workedTodayOnTaskSeconds` calculation — but only `member_id`-based indexes exist on this table (`schema.sql:433-435`), none covering `task_id`. Add:
```sql
CREATE INDEX idx_act_sess_task ON activity_sessions (task_id) WHERE task_id IS NOT NULL;
```

### 4.16 `project_budgets` and `project_member_limits` are a second duplicate-table candidate

Same spirit as 4.2 (`activity_sessions`/`timer_sessions`), weaker case: `project_budgets` (`schema.sql:486-504`) and `project_member_limits` (`schema.sql:508-524`) share nearly identical columns — `type`, `based_on`, `cost`, `resets`, `start_date`, `notify_at_pct`, `notify_project_members` — differing only in whether the row scopes to the whole project or one member within it. A single table with a `scope` column (`'project' | 'member'`) plus a nullable `member_id` would collapse two schemas that are really one concept at two granularities. Lower priority than 4.2 (less write-path duplication risk, these aren't both touched on every start/stop) — worth doing in the same pass if 4.2 is being done anyway, not urgent enough to justify alone.

### How to verify

- 4.1: confirm insert throughput/index size before/after switching a high-write table's PK default, on a synthetic load matching real traffic shape.
- 4.2/4.3/4.4/4.5: each is a schema change with existing call sites — grep for every read/write site before altering (same discipline as Phase 2/3's file inventories), migrate in a single deploy per item to keep rollback scoped.
- 4.6: reproduce the midnight-boundary case directly — start a session at 23:55, sync past midnight, confirm `workedTodaySeconds` today vs. tomorrow before and after the fix.
- 4.7: confirm actual disk usage delta over a fixed period (e.g. one week of normal capture volume) before/after moving screenshots off inline storage.
- 4.8: diff trigger-maintained `tasks.total_active_seconds` against the live `SUM()` for every task after rollout, confirm zero drift.
- 4.10: run the `pg_stat_activity` check under real concurrent load (multiple active trackers + web dashboard viewers) before deciding whether PgBouncer is actually needed.
- 4.11: before renaming/retyping anything, grep every read site of `created_by`/`updated_by`/`approved_by` across the codebase to confirm which tables' callers assume a Firebase uid vs. a memberId — this one has real blast radius if fixed carelessly.
- 4.12: confirm query plans (`EXPLAIN`) for the affected columns still use the remaining index after dropping the redundant one, before dropping in production.
- 4.13: reproduce directly — insert a screenshot/app-log/url-log row timed near local midnight in a non-UTC timezone, confirm it lands on the day the member actually worked it, before and after the fix.
- 4.14: grep every write path to `activity_screenshots.has_image` to confirm it's truly always `true` before dropping the column.
- 4.15: `EXPLAIN ANALYZE` the `workedTodayOnTaskSeconds` query before/after adding the index, confirm it stops sequential-scanning `activity_sessions`.
- 4.16: only worth doing alongside 4.2 — no standalone verification needed if deferred.

## Verification Plan (current, matches the revised Phase 1 above)

### Automated
- `npm run build` in `Tauri-App-Extension` — TypeScript/React compilation; only real risk from the one-line `fmtHours` change.
- `cargo check --manifest-path src-tauri/Cargo.toml` in `Tauri-App-Extension` — already passes as of this audit; Phase 1's revised scope makes no Rust changes, so this is a regression check, not something expected to newly fail.

### Manual
- Time-format boundaries, after the `fmtHours` fix: `27` → `27s`; `87` → `1m 27s`; `3627` (1h 0m 27s) → `1h 27s`; `3660` (1h 1m 0s) → `1h 1m`.
- Sanity-check the already-implemented persistence behavior (not expected to need fixing, just confirming the audit above matches reality): start tracking, wait >20s, confirm `activity_sessions.active_seconds` in Postgres (or the web dashboard viewing the same task) reflects live progress — this is the tracker's own `SESSION_SYNC_INTERVAL_SEC` heartbeat, already running.
- Force-kill the agent process mid-session (not a graceful quit): confirm loss is bounded by the last successful 20s tracker sync — this is the one case nothing can help with, since no code runs after the process dies. This is inherent to any heartbeat-based design, not a gap specific to the current implementation.

### Historical note
The bullets below describe what this plan verified *against the original, now-superseded Phase 1 design* (120s heartbeat, frontend-fed atomic) — kept only so the reasoning trail matches the collapsed "original plan" section above, not as current guidance: confirming `close_window`/`CloseRequested`/tray-quit all flush real numbers is still valid and worth spot-checking once, but the mechanism being checked is `tracker.current_task_progress()`, not `last_active_seconds`.
