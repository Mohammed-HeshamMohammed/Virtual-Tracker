# Implementation Plan — Fix Live Time Persistence & Adaptive Time Formatting in Desktop Agent

Fix the desktop agent (`Tauri-App-Extension`) so active tracking periodically persists progress to the backend (reusing the mechanism the web dashboard already relies on), auto-saves during active work, persists fully on stop *and* on unexpected quit, and displays adaptive time formatting across all hour/minute thresholds.

See [Task-Time-process-and-calculations.md](Task-Time-process-and-calculations.md) for the full architecture/data-flow reference this plan builds on.

## Corrections vs. the original draft

The original draft (pasted by the user) got the destination right but two premises wrong, both caught by reading the actual code:

1. **"Web dashboard syncs every 5s"** — false. `ACTIVITY_SESSION_SYNC_MS` (`Dashboard-Web/infrastructure/config/firestore-throttle.ts:9`) is **120s in production / 180s in dev**. The 5s figure is the web UI's *local* 1s tick rendered smoothly, and a separate *read-only* 5s session poll — neither of those write counters to the backend. Only `syncSession()` on the 120–180s timer actually persists `activeSeconds`.
2. **Missing call site** — `cargo check` confirms the working tree does not currently compile:
   ```
   src\agent\controller.rs:84:41: error[E0061]: this method takes 3 arguments but 2 arguments were supplied
   src\agent\controller.rs:320:14: error[E0061]: this method takes 3 arguments but 2 arguments were supplied
   src\agent\controller.rs:339:31: error[E0061]: this method takes 3 arguments but 2 arguments were supplied
   ```
   The original draft only mentioned fixing the two UI-reachable call sites (`start_task_session`, `stop_session`). Line 84 is inside `AgentController::stop()` — the app-quit path — and is not called out. All three must be fixed for the crate to build.

Everything else in the original draft (adaptive `fmtHours`, adding a `sync_session` command, threading `active_seconds` through) is correct in direction and kept below, with the interval corrected and the quit path added.

## Proposed Changes

### `Tauri-App-Extension/src-tauri`

#### `client/api/session.rs`
Already has `active_seconds: u64` on `post_session_action` (uncommitted, in progress). No further change needed.

#### `agent/controller.rs`
- Add a `last_active_seconds: AtomicU64` field to `AgentController`, default `0`. This is a purely in-process counter — no network, no lock contention beyond an atomic store — that exists solely so the Rust-side quit paths have *something real* to send instead of a hardcoded `0`.
- Add `note_active_seconds(&self, seconds: u64)`, called on every frontend 1s tick (see below): `self.last_active_seconds.store(seconds, Ordering::Relaxed)`.
- `stop()` (line 84, app-quit path — this is what `close_window`, `CloseRequested`, and the tray "Quit" item all call): fix the call to pass a 3rd argument, reading `self.last_active_seconds.load(Ordering::Relaxed)` instead of `0`. Bounds quit-time loss to ~1s (the tick interval) instead of up to a full heartbeat interval (120s) — see "Why this matters" below.
- `start_task_session` (line 320): pass `0` for the start baseline (unchanged behavior); also reset `last_active_seconds` to `0` here so a new session doesn't inherit the previous task's count.
- `stop_session`: change signature to accept `active_seconds: Option<u64>` (the UI's Stop button already has the exact live value from React state and should keep sending it directly — this path doesn't need the atomic). Pass through to `post_session_action("stop", None, active_seconds.unwrap_or(0))`.
- Add `sync_session(&self, active_seconds: u64) -> ActionResult`, calling `post_session_action("sync", None, active_seconds)`.

#### `lib.rs`
- `stop_session` Tauri command: accept `active_seconds: Option<u64>`, forward to controller.
- Add `sync_session(state, active_seconds: u64)` Tauri command; register in `tauri::generate_handler!`.
- Add `note_active_seconds(state, active_seconds: u64)` Tauri command — thin wrapper calling `state.controller.note_active_seconds(active_seconds)`; register in `tauri::generate_handler!`.

#### Why this matters (quit paths bypass React entirely)
Every normal way to close this app goes straight to Rust and never touches `App.tsx`:
- Titlebar close button → `close_window` command → `controller.stop(); app.exit(0)` (`lib.rs:51-54`)
- OS window close (X / Alt+F4) → `WindowEvent::CloseRequested` → same `controller.stop(); app.exit(0)` (`lib.rs:301-306`)
- Tray "Quit" → same `controller.stop(); app.exit(0)` (`lib.rs:277-280`)

None of these are edge cases — clicking the close button is the normal way most sessions end. Since Rust has never tracked seconds itself, all three paths currently send a hardcoded `0`, meaning **every ordinary app close loses whatever accumulated since the last successful counter push** — today that's since session start (no heartbeat exists yet); after this plan's heartbeat lands, it would still be bounded by the 120s heartbeat interval unless `last_active_seconds` is fed independently and more frequently, which is what the 1s local tick command above is for. This decouples two different costs:
- **Server write cost** (Firestore + Postgres + aggregation) stays cheap at 120s — no change to backend load.
- **Rust's local knowledge of the count** becomes fresh to ~1s, at effectively zero cost (in-process atomic store, no HTTP call) — so any quit path can send an accurate number regardless of the server heartbeat cadence.

### `Tauri-App-Extension/src/App.tsx`

- `handleStop()`: pass `liveActiveSeconds` — `invoke("stop_session", { activeSeconds: liveActiveSeconds })`.
- New heartbeat `useEffect`, active only while `tracking`, calling `invoke("sync_session", { activeSeconds: liveActiveSeconds })` on the interval decided below, followed by `refreshTaskTracking()` so this same client sees its own just-persisted number without waiting a full extra poll cycle.
- Existing 1s local-tick `useEffect` (`setLiveActiveSeconds((s) => s + 1)`, `App.tsx:661`): also call `invoke("note_active_seconds", { activeSeconds: liveActiveSeconds + 1 })` on the same tick, or debounce to every ~2-3s if per-second IPC proves noisy — this call is local-only (no network), so even at 1s it costs nothing server-side. This is what keeps `AgentController::last_active_seconds` fresh for the quit paths above.
- Replace `fmtHours()` with adaptive formatting (unchanged from the original draft — this part was correct):
  ```ts
  function fmtHours(totalSeconds: number | null | undefined): string {
    if (totalSeconds == null || totalSeconds <= 0) return "0s";
    const s = Math.max(0, Math.floor(totalSeconds));
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = s % 60;
    if (h > 0) {
      return m === 0 ? `${h}h ${sec}s` : `${h}h ${m}m`;
    }
    if (m > 0) {
      return `${m}m ${sec}s`;
    }
    return `${sec}s`;
  }
  ```

## Open decision — heartbeat interval

Not yet finalized — tracked here, resolved once the interval discussion below concludes:

| Option | Write load per active agent (vs. web's current prod rate) | Staleness window for other viewers |
|---|---|---|
| 5s | 24x | ~5s |
| 60s | 2x | ~60s |
| 120s / 180s (match `ACTIVITY_SESSION_SYNC_MS`) | 1x | 2–3 min |

Presence/online-status (WS ping every 30s, web-dashboard agent-status poll every 8s) is a separate mechanism and is not changed by this decision either way.

## Phase 2 (separate initiative) — Move canonical task data from Firestore to Postgres

Not part of Phase 1 above and not required to fix the live-time-persistence bug — tracked here because it surfaced directly from investigating it, and materially affects the same code paths. Scope this as its own pass, after Phase 1 ships.

### Why

- **Firestore is not on this VPS.** Confirmed via `Dashboard-Backend/.env.example` (`FIREBASE_PROJECT_ID`, `FIREBASE_SERVICE_ACCOUNT`) — it's Google-managed, external. Every task/time-tracking read or write today leaves the box. Postgres and Redis (the presence store behind `REDIS_URL`) are both local to the same VPS already.
- **Firestore's one differentiator — real-time push (`onSnapshot`) — isn't used anywhere.** Grepped both `Dashboard-Web` and `Dashboard-Backend`: zero hits. Every client polls REST endpoints on fixed intervals (5s / 8s / 120s) regardless of which database backs them. Paying for an external round-trip without using the feature that would justify it.
- **Frontend is already fully insulated.** `Dashboard-Web` never imports the Firestore client SDK (checked — no `firebase/firestore` imports, no direct `collection()`/`doc()` calls); it only calls the backend's own REST API. This makes it a **backend-only data-layer swap** — no frontend rearchitecture needed.
- **The current design already half-agrees.** Postgres dual-write mirrors (`task_member_progress`, `timer_sessions`) already exist behind `TASK_MEMBER_PROGRESS_PG_DUAL_WRITE`, specifically because the Postgres path is faster/local — "Postgres dual-write failures are logged and never block Firestore sync." Consolidating removes this permanent reconciliation burden instead of maintaining it indefinitely.
- Firebase Auth (sign-in) is a separate product from Firestore-the-database and is out of scope — this is only about where task/time-tracking *data* lives.

### Scope — files currently touching Firestore task data (grepped, not exhaustive by design, starting point for the real audit)

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
  `total_active_seconds`, `total_idle_seconds`, and `aggregated_progress_percent` are **not** in the formal schema catalog above (only in the earlier architecture doc, written by `aggregateTaskProgress`) — confirm during backfill whether these are genuinely stored on the Firestore doc or computed on read; if computed, drop them from this table and compute the same way in the new Postgres path instead of storing stale copies.
- New `task_assignments` table (currently Firestore-only, no Postgres equivalent):
  ```sql
  CREATE TABLE task_assignments (
    id UUID PRIMARY KEY,
    task_id UUID NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    user_id UUID NOT NULL,
    project_id UUID NOT NULL,
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
4. **Cutover, feature-flagged.** Reuse the existing `TASK_MEMBER_PROGRESS_PG_DUAL_WRITE`-style flag pattern: add a new flag (e.g. `TASK_DATA_SOURCE=postgres`) that switches backend *reads* to the new Postgres tables, while *writes* still go to both Firestore and Postgres (already true today for the dual-write fields; extend the same dual-write to the newly-added `tasks`/`task_assignments` columns for the cutover window).
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

## Phase 3 (separate initiative) — Projects & Tasks schema/query performance

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

## Phase 4 (separate initiative) — Post-migration schema hardening

Assumes Phase 2 and Phase 3 have already shipped and the task/project domain is fully relational. These are improvements to the *resulting* schema — normalization, correctness, and resource-fit for this specific VPS — not migration mechanics. Each item below is grounded in the actual current code (schema.sql, live query implementations), not speculative.

### 4.1 Primary key strategy — UUIDv4 → UUIDv7

Every table uses `gen_random_uuid()` (UUIDv4) as PK. Random insertion order means every insert can land anywhere in the btree, causing page splits and index bloat — a real, compounding write cost on a 2-vCPU KVM2 box, worst on the highest-write tables (`activity_app_logs`, `task_member_progress`, the new `task_time_tracking`).

**Fix:** use UUIDv7 (time-sortable, same 128-bit external shape — no application-facing change, no API contract change) instead of `gen_random_uuid()`. Postgres 17+ has native `uuidv7()`; earlier versions need `pg_uuidv7` extension or an application-side generator.

```sql
-- Postgres 17+:
ALTER TABLE task_member_progress ALTER COLUMN id SET DEFAULT uuidv7();
-- Repeat for other high-write tables once confirmed available; on <17, generate
-- UUIDv7 in the application layer instead (e.g. the `uuidv7` npm package) and
-- pass it explicitly rather than relying on a DB-side DEFAULT.
```

Apply to new high-write tables from Phase 2/3 (`task_time_tracking`, `task_assignments`) from day one rather than retrofitting later.

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

**Fix:** drop `accumulated_work_time`; enforce monotonicity on `active_seconds` directly, or rely on Phase 1's fixed sync path (which now always sends a real, monotonically-ticked value) making the ratchet unnecessary:

```sql
ALTER TABLE task_member_progress DROP COLUMN accumulated_work_time;
-- If a defensive floor is still wanted despite Phase 1's fix:
ALTER TABLE task_member_progress ADD CONSTRAINT chk_active_seconds_monotonic
  CHECK (active_seconds >= 0);  -- combine with an UPDATE trigger comparing OLD/NEW if a hard ratchet is required
```

### 4.4 Unify `member_id` vs `user_id` naming

`task_member_progress`, `activity_sessions`, `project_members` use `member_id`; the Firestore-derived `task_assignments`/`task_time_tracking` use `user_id` for the identical person reference. Post-migration is the moment to standardize — every JOIN across task/session tables otherwise has to remember which name applies where.

**Fix:** rename to `member_id` everywhere (majority convention already in Postgres):

```sql
ALTER TABLE task_assignments   RENAME COLUMN user_id TO member_id;
ALTER TABLE task_time_tracking RENAME COLUMN user_id TO member_id;
-- Update the composite indexes from Phase 2/3 accordingly:
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

`task_progress_aggregate` (and the Phase 3 overview query) recompute `SUM(active_seconds)` across all members on every read. Read cadence (5s/8s/120s polling, potentially many viewers per task) vastly exceeds write cadence (one sync per ~120s per active tracker after Phase 1). A trigger-maintained `tasks.total_active_seconds` (already a stored column in the Phase 2 DDL) is cheaper than recomputing the sum on every read, and doesn't depend on application code (`aggregateTaskProgress()`) always remembering to call it — the same class of "forgot to call it" bug Phase 1 exists to fix.

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

### How to verify

- 4.1: confirm insert throughput/index size before/after switching a high-write table's PK default, on a synthetic load matching real traffic shape.
- 4.2/4.3/4.4/4.5: each is a schema change with existing call sites — grep for every read/write site before altering (same discipline as Phase 2/3's file inventories), migrate in a single deploy per item to keep rollback scoped.
- 4.6: reproduce the midnight-boundary case directly — start a session at 23:55, sync past midnight, confirm `workedTodaySeconds` today vs. tomorrow before and after the fix.
- 4.7: confirm actual disk usage delta over a fixed period (e.g. one week of normal capture volume) before/after moving screenshots off inline storage.
- 4.8: diff trigger-maintained `tasks.total_active_seconds` against the live `SUM()` for every task after rollout, confirm zero drift.
- 4.10: run the `pg_stat_activity` check under real concurrent load (multiple active trackers + web dashboard viewers) before deciding whether PgBouncer is actually needed.

## Verification Plan

### Automated
- `npm run build` in `Tauri-App-Extension` — TypeScript/React compilation.
- `cargo check --manifest-path src-tauri/Cargo.toml` in `Tauri-App-Extension` — currently fails; must pass after this change.

### Manual
- Time-format boundaries: 27s → `27s`; 1m 27s → `1m 27s`; 1h 0m 27s → `1h 27s`; 1h 1m 0s → `1h 1m`.
- Start tracking on the desktop agent; confirm a `sync` heartbeat lands at the chosen interval and `TODAY, THIS TASK` / `REMAINING` update — check both from the agent itself and from a separate web dashboard session on the same task.
- Stop normally; confirm the final `liveActiveSeconds` persists exactly.
- Close the app via the titlebar close button while tracking (not via the in-app Stop control); confirm the persisted `activeSeconds` reflects the count as of ~1s before close, not `0` and not stale by a full heartbeat interval.
- Same check via OS window close (X / Alt+F4) and tray "Quit".
- Force-kill the process (no graceful shutdown at all) mid-session; confirm loss is bounded by the last successful `sync` heartbeat (worst case 120s) — this is the one case `last_active_seconds` can't help with, since nothing runs after the process dies.
