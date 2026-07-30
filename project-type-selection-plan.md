# Feature Plan: Project Type Selection (Normal vs Calling)

Status: **Draft — ready for review, not yet implemented**
Owner: Mohammed Hesham
Created: 2026-07-30
Revised: 2026-07-30 — switched from the hidden-system-task shortcut to a real
first-class taskless session (see §3). User explicitly chose the higher-cost,
architecturally-correct option over the cheaper one — this revision reflects
that, with the full backend blast-radius traced file by file, not assumed.

## 1. Problem

Today every project is the same shape: members work against Tasks, and Task
estimates/progress are what performance reporting is built on. We want a
second project type where Tasks aren't a concept the team manages at all —
members should be able to open the Tauri agent, pick the project, and hit
Start, with no task to select and no performance/progress math computed
against one.

**New project types:**
- **Normal** — unchanged. Tasks required, used to calculate performance.
- **Calling** — no Task picker anywhere. Assigned members each start their
  own timer straight against the project. No performance calculation.

**New creation UX:** the "New project" popup opens on a **type picker**
first (two cards: Normal / Calling, hover shows what each means), then
slide/fades into the existing multi-tab form once a type is chosen.

## 2. Relevant existing code (read before writing any of this)

- [`Dashboard-Web/features/projects/components/modals/project-modal.tsx`](Dashboard-Web/features/projects/components/modals/project-modal.tsx) — the entire create/edit modal. Already imports `motion` from `framer-motion` — no new animation dependency needed for the type-picker → form transition.
- [`Dashboard-Backend/src/modules/projects/routes.js`](Dashboard-Backend/src/modules/projects/routes.js) — `POST/PATCH /api/projects`, backed by `createProjectPg`/`updateProjectPg` in [`projects-postgres.service.js`](Dashboard-Backend/src/lib/postgres/projects-postgres.service.js).
- [`Dashboard-Backend/src/modules/schema/catalog/projects/index.js`](Dashboard-Backend/src/modules/schema/catalog/projects/index.js) — the `projects` field allowlist. No type column today.
- [`Tauri-App-Extension/src/App.tsx`](Tauri-App-Extension/src/App.tsx) — `handleStart` (~line 891) blocks with "Select a task to start tracking" when `selectedTaskId` is empty. `refreshTasks` calls `list_tasks(projectId)`.
- [`Tauri-App-Extension/src-tauri/src/agent/controller.rs`](Tauri-App-Extension/src-tauri/src/agent/controller.rs:344) — `start_task_session(task_id)` rejects an empty `task_id` before ever reaching the backend.
- [`Tauri-App-Extension/src-tauri/src/client/api/session.rs`](Tauri-App-Extension/src-tauri/src/client/api/session.rs) — `post_session_action` treats `task_id` as `Option<&str>` already.
- [`Dashboard-Backend/src/modules/activity/routes.js`](Dashboard-Backend/src/modules/activity/routes.js:223) — `POST /api/activity/session`, the single entry point for start/idle/resume/stop/sync. Every allowance check and `syncTaskTimeTracking` call is already gated behind `if (effectiveTaskId)` / `if (syncTaskId ...)`.
- [`Dashboard-Backend/src/lib/postgres/activity-events-postgres.service.js`](Dashboard-Backend/src/lib/postgres/activity-events-postgres.service.js) — `createPgSession`/`updatePgSession`/`findOpenPgSession` (the `activity_sessions` table CRUD) and `recordDailyActiveSecondsDelta`/`sumDailyMemberActiveSeconds`/`sumDailyMemberTaskActiveSeconds` (the daily-rollup tables that power both member-level and task-level hour caps).
- [`Dashboard-Backend/src/modules/tasks/timer-limit.service.js`](Dashboard-Backend/src/modules/tasks/timer-limit.service.js) — `computeTimerAllowance`, which blends **two independent caps**: a task-anchored one (task daily hours, total task estimate) and a **member-anchored** one (personal daily/weekly hour limit, completely task-independent — same numbers shown in the Tauri Profile panel).
- [`Dashboard-Backend/src/modules/tasks/task-time-tracking.js`](Dashboard-Backend/src/modules/tasks/task-time-tracking.js) — `syncTaskTimeTracking`. Writes `task_member_progress`/`timer_sessions` rows and recomputes task status/progress. **Does not write `time_entries`** — confirmed by grep, `time_entries` is only ever written via the generic schema-CRUD endpoint (manual/approved timesheet rows), a completely separate path from live agent tracking.
- [`Dashboard-Backend/src/lib/postgres/projects-postgres.service.js`](Dashboard-Backend/src/lib/postgres/projects-postgres.service.js) — `getProjectTrackedSecondsPg`/`computeProjectSpentCostPg`, both query `time_entries WHERE project_id = $1` **directly** — no task join at all.
- `Dashboard-Backend/src/lib/postgres/schema.sql` / `ensure-lookup-schema.js` — ground truth for actual columns: `time_entries.project_id` is **`NOT NULL`**, `time_entries.task_id` is **already nullable**. `activity_sessions` has `task_id` (nullable) but **no `project_id` column at all**. `daily_member_active_seconds` is keyed by `(member_id, day)` only — no task. `daily_member_task_active_seconds` is keyed by `(member_id, task_id, day)`.
- [`Dashboard-Backend/src/http/project-access.js`](Dashboard-Backend/src/http/project-access.js) — `getViewerProjectIds`, `viewerCanWriteProject`, `assertProjectAccessible` already exist and are exactly the access-control primitives a taskless session-start needs.

## 3. Decision: first-class taskless sessions (not a hidden task)

Traced the full blast radius of "a session with `task_id = NULL`" through
every file that reads or writes `activity_sessions`/`time_entries`/timer
allowance, instead of assuming. The picture is much better than it first
looked:

| System | Task-anchored? | Needs a change for taskless sessions? |
|---|---|---|
| `time_entries` / budgets / reports (`getProjectTrackedSecondsPg`, `computeProjectSpentCostPg`) | No — already keyed by `project_id` directly, `task_id` already nullable | **No.** Already correct today, verified by reading the actual queries. |
| Member daily/weekly hour cap (`daily_member_active_seconds`, `sumDailyMemberActiveSeconds`) | No — keyed by `(member_id, day)` only | **No.** `recordDailyActiveSecondsDelta` already writes this table unconditionally regardless of whether a task is present. |
| Task daily cap / total-task-estimate cap (`daily_member_task_active_seconds`, the task half of `computeTimerAllowance`) | Yes | N/A for Calling — this is the "performance" math the user explicitly wants skipped, and it already no-ops when there's no task. |
| `syncTaskTimeTracking` (task progress %, assignment status, review promotion) | Yes, entirely | **No.** Already only called `if (syncTaskId)` in `activity/routes.js` — a null task id already skips it end to end. |
| `activity_sessions` row itself | Has `task_id`, no `project_id` | **Yes.** This is the one real schema gap — nothing today records *which project* a taskless session belongs to. |
| Session-start access/allowance gating in `activity/routes.js` | Currently assumes a task if anything | **Yes.** Needs an explicit project-based branch. |

So the real, minimal-but-correct scope is: **add `project_id` to
`activity_sessions`, and give session-start an explicit "taskless, but tied
to a Calling project" path.** Everything downstream of `time_entries` and
the member's own hour cap already works unmodified — confirmed by reading
the actual SQL, not inferred.

## 4. Data model changes

### 4.1 `projects` — add `type`

```sql
ALTER TABLE projects
  ADD COLUMN IF NOT EXISTS type TEXT NOT NULL DEFAULT 'normal'
  CHECK (type IN ('normal', 'calling'));
```

- Set at creation, **immutable after** — `PATCH /api/projects/:id` rejects a
  `type` change (400). Converting an existing project with real task history
  either direction is a separate, harder migration problem, out of scope
  until asked for.

### 4.2 `activity_sessions` — add `project_id`

```sql
ALTER TABLE activity_sessions
  ADD COLUMN IF NOT EXISTS project_id UUID;

CREATE INDEX IF NOT EXISTS idx_act_sess_project
  ON activity_sessions (project_id) WHERE project_id IS NOT NULL;
```

- Nullable. Populated on every new session going forward, for both types:
  for a task-based (Normal) session, resolved server-side from `task.project_id`
  at start time (cheap, already fetching the task anyway); for a Calling
  session, taken directly from the `projectId` the client sends. This keeps
  every session self-describing without a join, useful for any future
  "who's tracking what, live" admin view — not strictly required by this
  feature, but free given the column has to exist anyway, and correct.

Both go in one new migration file:
`Dashboard-Backend/scripts/migrations/db_migration_project_type_and_sessions.sql`,
same idempotent `IF NOT EXISTS` style as the existing migration files, plus
mirrored `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` entries added to
`ensure-lookup-schema.js` (the codebase's pattern for schema changes that
must also apply automatically on every boot, not just via the one-off
migration script — confirmed both `schema.sql` and `ensure-lookup-schema.js`
currently define `activity_sessions` in parallel and must be kept in sync).

## 5. Backend changes

| File | Change |
|---|---|
| `Dashboard-Backend/scripts/migrations/db_migration_project_type_and_sessions.sql` | **New** — `projects.type`, `activity_sessions.project_id`. |
| `Dashboard-Backend/src/lib/postgres/ensure-lookup-schema.js` | Mirror both `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` statements into the boot-time schema-ensure list, next to the existing `activity_sessions` block. |
| `Dashboard-Backend/src/modules/schema/catalog/projects/index.js` | Add `type: "string"` to the `projects` field map. |
| `Dashboard-Backend/src/modules/projects/routes.js` | `POST /api/projects`: read `body.type`, default `"normal"`, validate it's one of the two values, pass through to `createProjectPg`. `PATCH`: reject any attempt to change `type` on an existing project (400, explicit error message, not a silent ignore). |
| `Dashboard-Backend/src/lib/postgres/projects-postgres.service.js` | `createProjectPg`/`updateProjectPg`: accept/persist `type`. |
| `Dashboard-Backend/src/lib/postgres/activity-events-postgres.service.js` | `SESSION_COLUMNS` gains `project_id`. `createPgSession(row)` accepts `row.projectId`, inserts it. `updatePgSession` accepts `patch.projectId` (parity with the existing `patch.taskId` handling). `findOpenPgSession`/`getPgSessionById`/`fetchPgSessionsForDashboard`/`fetchAllOpenPgSessions` automatically return it since they select `SESSION_COLUMNS`. |
| `Dashboard-Backend/src/http/project-access.js` | **New helper** `isProjectMemberForTimer(db, viewer, projectId)` — true if viewer has management role, or has *any* `project_members` row for that project (any project_role — this is the Calling-project equivalent of "task assignment" gating a Normal-project timer). Thin wrapper, reuses the existing `project_members` query pattern already in `viewerCanCreateProjectTasks`. |
| `Dashboard-Backend/src/modules/tasks/timer-limit.service.js` | **New** `computeMemberDailyWeeklyAllowance(db, memberId, { currentCumulativeActiveSeconds })` — extracted from the member-cap half of `computeTimerAllowance` (shift check, weekly/daily limit hours, `sumDailyMemberActiveSeconds`), with every task-specific piece (`taskDailyCapSeconds`, `totalTaskSeconds` remainder) dropped. `computeTimerAllowance` itself is refactored to call this shared helper internally for its member-cap portion, so there's exactly one implementation of "personal daily/weekly hour cap," not two copies that can drift. |
| `Dashboard-Backend/src/modules/activity/routes.js` | `POST /api/activity/session`: read `projectId` from body alongside the existing `taskId`. New branch for start/resume when there's no `taskId`: require `projectId`, load the project, 400 if `project.type !== 'calling'` (a Normal project can never start a taskless session), `403` via `isProjectMemberForTimer` if the viewer isn't on that project, then run `computeMemberDailyWeeklyAllowance` (still enforced — this is a compliance cap, not "performance") instead of the task-anchored `computeTimerAllowance`. `createPgSession`/`updatePgSession` calls get `projectId` threaded through (resolved from the task when `taskId` is present, from the body when it isn't). The existing `if (syncTaskId ...)` block is untouched — it already correctly no-ops for a taskless session. |
| `Dashboard-Backend/src/modules/projects/form-config.js` | Add project `type` to `PROJECT_FORM_FIELDS` so it round-trips through `getProjectFormConfig`/edit-state. |

Everything under §3's "No" column (`time_entries`, budgets, reports,
`syncTaskTimeTracking`, member daily/weekly cap plumbing) needs **zero**
changes — confirmed by reading the actual code paths, not assumed.

## 6. Frontend changes (Dashboard-Web)

`project-modal.tsx` currently renders the tabbed form immediately. New flow,
create-mode only (edit-mode always skips straight to the form — type is
locked once a project exists):

1. `addProjectStep: "type" | "form"` state, starts at `"type"` for create,
   `"form"` for edit.
2. Type step: two cards, "Normal" / "Calling". Hover tooltip on each
   (reusing the existing `IconTooltip`/`Info` pattern already in this file)
   — Normal: *"Tasks are used to calculate performance"*; Calling: *"No
   tasks needed — each member starts their own timer"*.
3. Picking a card sets `addForm.type` and flips `addProjectStep` to
   `"form"`. Wrap both steps in `AnimatePresence`/`motion.div` (library
   already imported) with a slide+fade — `initial={{ opacity: 0, x: 24 }}`
   → `animate={{ opacity: 1, x: 0 }}`, matching the modal's own existing
   `motion.div` transition style.
4. `AddProjectFormState` gets `type: "normal" | "calling"`;
   `formStateToPayload`/`CreateProjectFormPayload` pass it through.
5. Project list/detail types (`infrastructure/api`) gain `type` so the rest
   of the dashboard (task board, "add task" entry points) can gate on it —
   Calling projects hide any Tasks tab/button entirely rather than showing
   an empty one.

## 7. Tauri agent changes

- `ProjectInfo` (`App.tsx` + `src-tauri/src/types.rs`) gains
  `projectType: "normal" | "calling"`, threaded through
  `fetch_viewer_projects` in `work.rs`.
- `SessionInfo` (`App.tsx` + `types.rs`) gains `projectId?: string | null`.
  `session_info_from_json` (`session.rs`) parses it from the response the
  same way it already parses `taskId`.
- `refreshTasks`: skip the `list_tasks` call entirely when the selected
  project's `projectType === "calling"` — clear `tasks`/`selectedTaskId`.
- UI: when the selected project is Calling, hide the "Your tasks" `Dropdown`
  section entirely (not just disable it); signal-card copy becomes *"Start
  when you're ready"* instead of *"Select a task and start when you're
  ready"*; the page header/clock label uses the project's name instead of a
  task title when `session.projectId` is set and `session.taskId` isn't.
- `handleStart`: for a Calling project, skip the `if (!selectedTaskId)`
  guard and call a **new** Tauri command `start_project_session(project_id)`
  instead of `start_task_session(task_id)` — kept as a separate command
  rather than overloading the existing one, since the two have genuinely
  different preconditions (task-limit lookup vs. none) and callers.
- `src-tauri/src/agent/controller.rs`: new `start_project_session(&self, project_id: &str) -> ActionResult`, mirrors `start_task_session` (~line 344) minus the `fetch_task_time_tracking` baseline-seed step (nothing to seed against without a task) — calls `post_session_action("start", None, active_baseline: 0, idle_baseline: 0)` with the new `project_id` param.
- `src-tauri/src/client/api/session.rs`: `post_session_action` gains a `project_id: Option<&str>` parameter, added to the JSON payload as `projectId` exactly like the existing `taskId` handling.
- `taskTracking`/progress UI (stat grid, progress bar, "Task budget left")
  simply doesn't render for a Calling session (no `selectedTaskId`) — this
  is already how the empty/no-task state renders today (`App.tsx` ~line
  1252), no new conditional needed.

## 8. File change list

| Repo | File | Action |
|---|---|---|
| Dashboard-Backend | `scripts/migrations/db_migration_project_type_and_sessions.sql` | New |
| Dashboard-Backend | `src/lib/postgres/ensure-lookup-schema.js` | Modify |
| Dashboard-Backend | `src/modules/schema/catalog/projects/index.js` | Modify |
| Dashboard-Backend | `src/modules/projects/routes.js` | Modify |
| Dashboard-Backend | `src/lib/postgres/projects-postgres.service.js` | Modify |
| Dashboard-Backend | `src/lib/postgres/activity-events-postgres.service.js` | Modify |
| Dashboard-Backend | `src/http/project-access.js` | Modify (`isProjectMemberForTimer`) |
| Dashboard-Backend | `src/modules/tasks/timer-limit.service.js` | Modify (extract `computeMemberDailyWeeklyAllowance`) |
| Dashboard-Backend | `src/modules/activity/routes.js` | Modify (taskless start/resume branch) |
| Dashboard-Backend | `src/modules/projects/form-config.js` | Modify |
| Dashboard-Backend | `src/modules/dashboard/dashboard-base-loader.js` | Modify (thread `project_id` into the session-row mapper, ~line 92-103, so any dashboard consumer of this shape can see it without a task join) |
| Dashboard-Web | `features/projects/components/modals/project-modal.tsx` | Modify (type step + transition) |
| Dashboard-Web | `features/projects/components/modals/project-type-picker.tsx` | New |
| Dashboard-Web | `infrastructure/api` project types/payload | Modify |
| Dashboard-Web | Task board / "add task" entry points | Modify (gate on `project.type`) |
| Tauri-App-Extension | `src/App.tsx` | Modify |
| Tauri-App-Extension | `src-tauri/src/types.rs` | Modify (`ProjectInfo`, `SessionInfo`) |
| Tauri-App-Extension | `src-tauri/src/client/api/work.rs` | Modify (`fetch_viewer_projects` mapping) |
| Tauri-App-Extension | `src-tauri/src/client/api/session.rs` | Modify (`post_session_action` + `session_info_from_json`) |
| Tauri-App-Extension | `src-tauri/src/agent/controller.rs` | Modify (new `start_project_session`) |
| Tauri-App-Extension | `src-tauri/src/lib.rs` | Modify (register the new Tauri command) |

## 9. Edge cases

- **Existing projects/sessions** — migration defaults `type = 'normal'`,
  `project_id` stays `NULL` on old session rows; zero behavior change for
  anything that exists today.
- **A Normal project's task gets deleted mid-session** — pre-existing
  behavior, unrelated to this feature (the task-based allowance block
  already handles a missing task by just not finding one); not touched.
- **Removing a member from a Calling project while their timer is
  running** — `isProjectMemberForTimer` is only checked on **start/resume**,
  matching how task-assignment is only checked on start today; an
  in-progress session isn't killed retroactively. Same behavior class as
  Normal projects, no new inconsistency introduced.
- **Type immutability** — `PATCH /api/projects/:id` rejects a `type` change
  outright (400) instead of silently ignoring it, so a client bug can't
  quietly desync the picker from stored state.
- **A member starts a session with neither `taskId` nor `projectId`** —
  currently technically possible (silently creates an untracked session);
  this pass makes that an explicit 400. A real, if minor, correctness fix
  that falls out of doing this properly.

## 10. Open items to confirm before implementing

1. Full-repo grep for every other reader of `activity_sessions.task_id`
   beyond the files traced in §2/§3 (`agent-heartbeat.js`,
   `config/activity-session.js`, `entity-bootstrap-manifest.js` were found
   but not fully read — they read as config/bootstrap plumbing, not
   business logic that branches on task presence, but confirm before
   shipping).
2. Any live "who's currently tracking what" admin/reporting view beyond
   `dashboard-base-loader.js` that would want `project_id` surfaced
   directly rather than derived — check `general-dashboard-service.js` /
   `command-center-service.js` for anything that currently assumes a task
   join to show a project name for an active session.
3. Exact copy for the two type cards and their hover tooltips.

## 11. Status log

- 2026-07-30 — Initial draft (hidden-system-task approach).
- 2026-07-30 — User rejected the lazy option, asked for the best/correct
  outcome regardless of implementation cost. Traced the full blast radius
  of a real taskless session through every relevant file instead of
  guessing: `time_entries`/budgets/reports already key off `project_id`
  directly and already tolerate a null `task_id` (verified in
  `schema.sql`); the member daily/weekly hour cap already tracks
  task-independently (`daily_member_active_seconds`); `syncTaskTimeTracking`
  already only runs when a task is present. The only genuine gaps were
  `activity_sessions` missing a `project_id` column and the session-start
  route having no taskless branch. Revised the plan to the smallest change
  that is still fully architecturally correct, rather than the smallest
  change that merely avoids touching anything.
