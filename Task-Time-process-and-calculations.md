# Task & Time Tracking — Exhaustive Architecture, Data Types & Calculations Specification

This document is an exhaustive, deep-dive specification detailing the end-to-end data flow, database schemas, TypeScript & Rust data types, HTTP API payloads, mathematical formulas, and execution traces for task creation, time tracking, budget allowance gating, active session ticking, and activity capture across **Tauri-App-Extension** (Desktop Agent), **Dashboard-Web**, and **Dashboard-Backend**.

---

## 0. Dual-Client Architecture (Important)

Timer behavior is split across two clients with different responsibilities:

| Client | Location | Counter ticking | Backend counter sync | Activity capture |
| :--- | :--- | :--- | :--- | :--- |
| **Web dashboard** | `ActivityTrackingProvider` | 1s local tick | Counter sync every 120s (prod) / 180s (dev) via `POST /api/activity/session` (`sync`) + `POST /api/tasks/:id/time-tracking` — a **separate**, read-only `GET /api/activity/session` poll runs every 5s | Idle detection (non-agent mode) |
| **Tauri agent UI** | `App.tsx` | 1s local tick (`liveActiveSeconds`) | **Start/stop only** — always sends `activeSeconds: 0`, `idleSeconds: 0` | Delegated to `ActivityTracker` |
| **Tauri agent tracker** | `tracker.rs` | N/A | Polls `GET /api/activity/session` every 5s | Screenshots, app, URL via `POST /api/activity/events` |

In **agent capture mode**, the web timer requires the user to select a task in the desktop agent before starting (`"Select a project and task in the Virtual Tracker Agent before starting the timer."`). The web client owns authoritative counter sync; the agent owns capture and its own standalone timer UI.

> **Known gap (currently mid-fix, build is broken):** The Tauri agent UI ticks locally but does not send periodic `sync` actions with live counters. As of this writing there's an **uncommitted, incomplete fix in progress**: `session.rs`'s `post_session_action` was changed to accept a real `active_seconds: u64` parameter instead of hardcoding `0`, but its 3 call sites in `controller.rs` (lines 84, 320, 339) were not updated to pass it — the Rust crate does not currently compile. `App.tsx`'s `invoke("start_task_session", …)` also still only passes `taskId`, not `liveActiveSeconds`. Until the call sites and the Tauri command signature are updated end-to-end, task progress for agent-only workflows will not accumulate in Firestore/Postgres — and the crate won't build at all in its current state.

---

## 1. Complete Data Schemas & Type Definitions

### 1.1 Source-of-Truth Matrix

| Data | Canonical store | Notes |
| :--- | :--- | :--- |
| Per-member timer counters | Firestore `tasks/{taskId}/time_tracking` | API alias: `task-time-tracking` |
| Task-level aggregates | Firestore `tasks` doc | `total_active_seconds`, `total_idle_seconds`, `aggregated_progress_percent` |
| Open activity session | Postgres `activity_sessions` | All clients read/write here |
| Per-member progress mirror | Postgres `task_member_progress` | Optional dual-write; feature flag `TASK_MEMBER_PROGRESS_PG_DUAL_WRITE` |
| Per-task timer segments | Postgres `timer_sessions` | Optional dual-write alongside `task_member_progress` |
| Timesheet rows | Postgres `time_entries` | **Manual CRUD only** — not auto-created on session stop |
| Activity capture | Postgres `activity_screenshots`, `activity_app_logs`, `activity_url_logs` | Written by `POST /api/activity/events` |

Postgres dual-write failures are logged and never block Firestore sync.

---

### 1.2 PostgreSQL Database Schemas (`Dashboard-Backend`)

#### A. `tasks` — **there is no Postgres `tasks` table** (correction)

Postgres has **no `tasks` table at all** — checked `Dashboard-Backend/src/lib/postgres/schema.sql` and `ensure-lookup-schema.js` (the real source of truth). `expected_seconds`, `overtime_seconds`, `total_active_seconds`, `total_idle_seconds`, `title`, `status` etc. exist **only** on the Firestore `tasks/{taskId}` doc (see §1.3.A below).

The closest Postgres equivalent to a "task totals" record is a **view**, not a table:

```sql
CREATE OR REPLACE VIEW task_progress_aggregate AS
SELECT
  task_id,
  SUM(active_seconds) AS total_active_seconds,
  SUM(idle_seconds)   AS total_idle_seconds,
  COUNT(DISTINCT member_id) AS contributing_members
FROM task_member_progress
GROUP BY task_id;
```

This view derives its totals live from `task_member_progress` rows (table B below) — it is not itself written to.

> **Runtime estimation** always reads live Firestore task fields (`duration_hours_per_day`, `overtime_hours_per_day`, date range / `working_days`); there is no Postgres snapshot to fall back on.

#### B. `task_member_progress` (Per-Member Progress Mirror)
| Column Name | Data Type | Constraints | Description |
| :--- | :--- | :--- | :--- |
| `id` | `UUID` | `PRIMARY KEY DEFAULT gen_random_uuid()` | Unique progress mirror record ID |
| `task_id` | `UUID` | `NOT NULL` | References `tasks.id` |
| `member_id` | `UUID` | `NOT NULL` | References member ID |
| `active_seconds` | `BIGINT` | `NOT NULL DEFAULT 0 CHECK (active_seconds >= 0)` | Active work seconds for this member on this task |
| `idle_seconds` | `BIGINT` | `NOT NULL DEFAULT 0 CHECK (idle_seconds >= 0)` | Idle seconds for this member on this task |
| `progress_percentage` | `NUMERIC(5,2)` | `NOT NULL DEFAULT 0 CHECK (progress_percentage >= 0)` | `round(min(100, active / planned * 100))` |
| `accumulated_work_time`| `BIGINT` | `NOT NULL DEFAULT 0` | `GREATEST(existing, active_seconds)` on each sync |
| `last_started_at` | `TIMESTAMPTZ` | `NULLABLE` | Set on first `start`/`resume` if previously null |
| `last_activity_at` | `TIMESTAMPTZ` | `NULLABLE` | Timestamp of last recorded activity tick |
| `created_at` | `TIMESTAMPTZ` | `NOT NULL DEFAULT now()` | Record creation timestamp |
| `updated_at` | `TIMESTAMPTZ` | `NOT NULL DEFAULT now()` | Record update timestamp |
| **Unique Constraint** | — | `UNIQUE (task_id, member_id)` | One progress record per member/task pair |

#### C. `timer_sessions` (Per-Task Timer Segments — dual-write)
| Column Name | Data Type | Constraints | Description |
| :--- | :--- | :--- | :--- |
| `id` | `UUID` | `PRIMARY KEY DEFAULT gen_random_uuid()` | Segment ID |
| `task_id` | `UUID` | `NOT NULL` | Task being timed |
| `member_id` | `UUID` | `NOT NULL` | Member ID |
| `started_at` | `TIMESTAMPTZ` | `NOT NULL` | Segment start |
| `ended_at` | `TIMESTAMPTZ` | `NULLABLE` | Segment end (`null` while open) |
| `active_seconds` | `BIGINT` | `NULLABLE` | Active seconds at close/sync |
| `idle_seconds` | `BIGINT` | `NULLABLE` | Idle seconds at close/sync |
| `source` | `TEXT` | `NOT NULL DEFAULT 'web' CHECK (source IN ('web', 'desktop_agent'))` | Originating client |
| `activity_session_id` | `VARCHAR(128)` | `NULLABLE` | Link to Postgres `activity_sessions.id` |

Inserted on `start`/`resume`; updated on `stop`, `sync`, `idle`.

#### D. `activity_sessions` (Active Timer Sessions Table)
| Column Name | Data Type | Constraints | Description |
| :--- | :--- | :--- | :--- |
| `id` | `UUID` | `PRIMARY KEY DEFAULT gen_random_uuid()` | Session UUID |
| `member_id` | `UUID` | `NOT NULL` | Tracked member ID |
| `task_id` | `UUID` | `NULLABLE` | Active task ID |
| `status` | `VARCHAR(20)` | `NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'idle', 'stopped'))` | Current status |
| `started_at` | `TIMESTAMPTZ` | `NOT NULL DEFAULT now()` | Session start timestamp |
| `ended_at` | `TIMESTAMPTZ` | `NULLABLE` | Session stop timestamp (`null` if currently active) |
| `active_seconds` | `INTEGER` | `NOT NULL DEFAULT 0` | Current active seconds for this session |
| `idle_seconds` | `INTEGER` | `NOT NULL DEFAULT 0` | Current idle seconds for this session |
| `updated_at` | `TIMESTAMPTZ` | `NOT NULL DEFAULT now()` | Last sync timestamp |

`workedTodaySeconds` / `workedWeekSeconds` in allowance math sum `activity_sessions.active_seconds` from Postgres.

#### E. `time_entries` (Timesheet Entries Table)
| Column Name | Data Type | Constraints | Description |
| :--- | :--- | :--- | :--- |
| `id` | `UUID` | `PRIMARY KEY DEFAULT gen_random_uuid()` | Entry ID |
| `member_id` | `UUID` | `NOT NULL` | Member ID |
| `project_id` | `UUID` | `NOT NULL` | Project ID |
| `task_id` | `UUID` | `NULLABLE` | Task ID |
| `date` | `DATE` | `NOT NULL` | Entry date (`YYYY-MM-DD`) |
| `start_time` | `TIME` | `NULLABLE` | Start wall-clock time |
| `end_time` | `TIME` | `NULLABLE` | End wall-clock time |
| `duration` | `INTEGER` | `NOT NULL DEFAULT 0` | Duration in minutes |
| `description` | `TEXT` | `NULLABLE` | Work notes |
| `billable` | `BOOLEAN` | `NOT NULL DEFAULT false` | Billable flag |
| `status` | `VARCHAR(20)` | `NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected'))` | Approval status |
| `source` | `VARCHAR(20)` | `NOT NULL DEFAULT 'manual' CHECK (source IN ('manual', 'tracked'))` | Origin flag |
| `created_by` | `VARCHAR(255)` | `NULLABLE` | Creator identifier, set by `postgres-crud.service.js` |
| `updated_by` | `VARCHAR(255)` | `NULLABLE` | Last updater identifier |
| `created_at` | `TIMESTAMPTZ` | `NOT NULL DEFAULT now()` | Created timestamp |
| `updated_at` | `TIMESTAMPTZ` | `NOT NULL DEFAULT now()` | Updated timestamp |

> **Not auto-written on session stop.** The only writer is schema CRUD (`/api/time-entries` via `postgres-crud.service.js`). Tracked work lives in Firestore `time_tracking` and optionally `task_member_progress`.

---

### 1.3 Firestore Schemas

#### A. `tasks/{taskId}` (task document — estimation fields)
| Field | Type | Description |
| :--- | :--- | :--- |
| `duration_hours_per_day` | number | Planned hours per working day |
| `overtime_hours_per_day` | number | Approved overtime hours per working day |
| `start_date` / `due_date` | timestamp/string | Used to count weekdays for `workingDays` |
| `working_days` / `duration_days` | number | Fallback if date range unavailable (minimum 1) |
| `total_active_seconds` | number | Aggregated across all members (maintained by `aggregateTaskProgress`) |
| `total_idle_seconds` | number | Aggregated idle seconds |
| `aggregated_progress_percent` | number | Task-level progress vs estimate |

#### B. `tasks/{taskId}/time_tracking/{docId}` (per-member timer — API alias `task-time-tracking`)
| Field | Type | Description |
| :--- | :--- | :--- |
| `id` | uuid | Document ID |
| `task_id` | uuid | Parent task |
| `user_id` | uuid | Member ID |
| `project_id` | uuid | Project ID |
| `active_seconds` | int | Cumulative active seconds for this member |
| `idle_seconds` | int | Cumulative idle seconds |
| `progress_percentage` | number | Per-member progress (nullable until estimate exists) |
| `started_at` | timestamp | First start/resume timestamp |
| `last_activity_at` | timestamp | Last sync timestamp |
| `session_id` | string | Linked `activity_sessions.id` |
| `review_notes` | string | Review notes |
| `created_at` / `updated_at` | timestamp | Audit fields |

#### C. `task_assignments` (assignment lifecycle)
Assignment status transitions driven by timer sync: `todo`/`blocked` → `in_progress` (on start/resume); `in_progress`/`todo` → `in_review` (on auto-promote when aggregate active ≥ estimate).

---

### 1.4 Desktop Agent Rust Data Types (`src-tauri/src/types.rs`)

```rust
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum ActivityEvent {
    #[serde(rename = "screenshot")]
    Screenshot {
        image_data: String,       // base64
        app_name: String,
        page_title: String,
        activity_level: u32,      // 0–100
    },
    #[serde(rename = "app")]
    App {
        app_name: String,
        page_title: String,
        duration_seconds: u64,    // typically 15
    },
    #[serde(rename = "url")]
    Url {
        url: String,
        page_title: String,
        duration_seconds: u64,
    },
}

pub struct AgentTask {
    pub id: String,
    pub title: String,
    pub status: String,
    pub project_id: String,       // included in API response mapping
}

pub struct SessionInfo {
    pub id: Option<String>,
    pub status: String,           // "active" | "idle" | "stopped"
    pub task_id: Option<String>,
    pub task_title: Option<String>,
    pub active_seconds: u64,
    pub idle_seconds: u64,
}

/// Flattened from GET /api/tasks/:id/time-tracking (nested timerAllowance → top-level fields).
pub struct TaskTimeTracking {
    pub active_seconds: u64,
    pub idle_seconds: u64,
    pub task_status: String,
    pub estimated_seconds: Option<u64>,
    pub overtime_seconds: Option<u64>,   // overtime-only portion of estimate
    pub progress_percent: Option<f64>,
    pub worked_today_seconds: Option<u64>,
    pub worked_today_on_task_seconds: Option<u64>,
    pub allowed_remaining_seconds: Option<i64>,  // None = unlimited
    pub limit_reached: bool,
    pub allowance_message: Option<String>,
}

pub struct ActionResult {
    pub success: bool,
    pub error: Option<String>,
    pub session: Option<SessionInfo>,
}
```

---

## 2. Step-by-Step Task Lifecycle & Process Execution

### Phase 1: Task Creation & Live Allocation Estimation

1. **Task Creation (`POST /api/tasks`)**:
   - Web application creates task document in Firestore (`tasks/{taskId}`) and mirrors key fields to Postgres `tasks`.
   - Postgres `expected_seconds` / `overtime_seconds` are snapshot mirrors only.

2. **Working Days (`workingDaysForTask`)**:
   - Primary: count weekdays (Mon–Fri) between `start_date` and `due_date`.
   - Fallback: `working_days` / `duration_days` from task doc.
   - Minimum: `1`.

3. **Live Estimate Calculation (`estimateAssignmentSeconds`)** — always recomputed from the current Firestore task doc (assignment `expected_seconds` is a stale snapshot refreshed only when assignees change):

   $$\text{estimatedSeconds} = \lfloor \text{workingDays} \times (\text{duration\_hours\_per\_day} + \text{overtime\_hours\_per\_day}) \times 3600 \rfloor$$

   Returns `null` when total hours per day ≤ 0.

4. **Overtime Breakdown (`estimateAssignmentOvertimeSeconds`)**:

   $$\text{overtimeSeconds} = \lfloor \text{workingDays} \times \text{overtime\_hours\_per\_day} \times 3600 \rfloor$$

5. **Task Daily Cap (`computeTaskDailyHours`)**:

   $$\text{taskDailyHours} = \text{duration\_hours\_per\_day} + \text{overtime\_hours\_per\_day}$$

---

### Phase 2: Task Discovery in Desktop Agent (`Tauri-App-Extension`)

```
[Agent Component] ──(1) GET /api/activity/scope──> Returns viewerMemberId (UUID)
                  ──(2) GET /api/projects────────> Returns ProjectInfo[]
                  ──(3) GET /api/tasks?assigned_to={memberId}&project_id={projectId}
                                                 ──> Returns AgentTask[]
                  ──(4) GET /api/tasks/{taskId}/time-tracking
                                                 ──> Returns TaskTimeTracking JSON
```

1. **Task Query Parameters**:
   - `assigned_to` (`UUID`): Resolved internally via `GET /api/activity/scope` → `viewerMemberId`.
   - `project_id` (`UUID`): Selected project ID from agent UI.
2. **Task Filter Logic (`fetch_assigned_tasks` in `work.rs`)**:
   - Excludes: `done`, `completed`, `cancelled`, `canceled`, `archived`.
   - Returns actionable tasks (`todo`, `in_progress`, etc.).

---

### Phase 3: Multi-Tier Cap & Allowance Computation Engine (`computeTimerAllowance`)

Before starting a timer or on every poll, `computeTimerAllowance` calculates remaining capacity. Implemented in `timer-limit.service.js`.

#### Mathematical Formulations

1. **Task Daily Cap Seconds**:
   $$\text{taskDailyCapSeconds} = \text{taskDailyHours} \times 3600$$

2. **Member Daily & Weekly Limit Seconds**:
   $$\text{memberDailyLimitSeconds} = \text{dailyLimitHours} \times 3600$$
   $$\text{memberWeeklyLimitSeconds} = \text{weeklyLimitHours} \times 3600$$

3. **Effective Daily Cap Hours**:
   $$\text{effectiveDailyCapHours} = \begin{cases}
   \min(\text{taskDailyHours}, \text{dailyLimitHours}) & \text{if both } > 0 \\
   \text{taskDailyHours} & \text{if } \text{dailyLimitHours} \le 0 \\
   \text{dailyLimitHours} & \text{if } \text{taskDailyHours} \le 0
   \end{cases}$$

4. **Shift-Based Members (`memberUsesShiftsForLimits`)**:
   When enabled and member uses shift allowances, **daily and weekly caps are skipped**. Only total task budget applies:
   $$\text{allowedRemainingSeconds} = \max(0, \text{totalTaskSeconds} - \text{currentCumulativeActiveSeconds})$$
   or `null` if no task budget.

5. **Logged Active Seconds Queries** (Postgres `activity_sessions.active_seconds` via `sumPgMemberActiveSeconds`):
   - `workedTodaySeconds`: Active work today across all tasks.
   - `workedTodayOnTaskSeconds`: Active work today on *this specific task*.
   - `workedWeekSeconds`: Active work across the current **Monday–Sunday calendar week** (`getRollingWeekDays()`, `dashboard-utils.js:49-68`, is Monday-anchored — despite the name, it is a fixed calendar week, not a trailing 7-day window).

6. **Allowed Remaining Seconds Calculation**:
   The engine collects applicable constraint remainders into set $R$, **each individually clamped to ≥ 0** via `Math.max(0, …)` (`timer-limit.service.js:86-102`) — this matters: without the clamp, a member already over a cap would push `maxCumulativeActiveSeconds` below their current count:
   $$R = \left\{
   \begin{array}{ll}
   \max(0, \text{effectiveDailyCapSeconds} - \text{workedTodayOnTaskSeconds}), & \text{if } \text{effectiveDailyCapSeconds} > 0 \\
   \max(0, \text{taskDailyCapSeconds} - \text{workedTodayOnTaskSeconds}), & \text{else if } \text{taskDailyCapSeconds} > 0 \\
   \max(0, \text{memberDailyLimitSeconds} - \text{workedTodaySeconds}), & \text{if } \text{memberDailyLimitSeconds} > 0 \\
   \max(0, \text{memberWeeklyLimitSeconds} - \text{workedWeekSeconds}), & \text{if } \text{memberWeeklyLimitSeconds} > 0 \text{ AND } \text{dailyLimitHours} \le 0 \\
   \max(0, \text{totalTaskSeconds} - \text{currentCumulativeActiveSeconds}), & \text{if } \text{totalTaskSeconds} > 0
   \end{array}
   \right\}$$

   $$\text{allowedRemainingSeconds} = \begin{cases} \min(R) & \text{if } |R| > 0 \\ \text{null (unlimited)} & \text{otherwise} \end{cases}$$

   > **Field-naming gotcha:** the `taskDailyCapSeconds` returned in the response payload (§3.1) is **not** always the raw task cap — it's `effectiveDailyCapSeconds || taskDailyCapSeconds` (`timer-limit.service.js:110`). When a member's own daily limit is tighter than the task's cap, this field silently reports the *member-capped* value even though `memberDailyLimitSeconds` is also surfaced separately in the same payload.

7. **Derived Fields**:
   $$\text{maxCumulativeActiveSeconds} = \text{currentCumulativeActiveSeconds} + \text{allowedRemainingSeconds}$$
   (only when `allowedRemainingSeconds` is not null)

8. **Limit Gating Condition**:
   $$\text{limitReached} = \begin{cases} \text{true} & \text{if } \text{allowedRemainingSeconds} \ne \text{null} \text{ AND } \text{allowedRemainingSeconds} \le 0 \\ \text{false} & \text{otherwise} \end{cases}$$

9. **Enforcement on Sync (`enforceTimerAllowanceOnSync`)**:
   - On `start`/`resume`: throws `TIMER_LIMIT_REACHED` if `limitReached`.
   - On any action: caps incoming `activeSeconds` to `maxCumulativeActiveSeconds` if exceeded; returns `{ activeSeconds, capped: true, allowance }`.

10. **Pre-Start Gating (`POST /api/activity/session`)**:
    Allowance is checked **before** session creation on `start`/`resume` (returns `403` if limit reached). Previously enforcement only ran inside the best-effort task sync after session was already active.

---

### Phase 4: Session Initiation (`action = "start"`)

Supported session actions: **`start`**, **`idle`**, **`resume`**, **`stop`**, **`sync`**.

#### A. Tauri Agent UI Trigger (`App.tsx`)
```typescript
const handleStart = async () => {
  if (!selectedTaskId) {
    toast.error("Select a task to start tracking");
    return;
  }
  if (taskTracking?.limitReached) {
    toast.error(taskTracking.allowanceMessage || "Maximum allowed work time reached.");
    return;
  }
  setBusy(true);
  const result = await invoke<ActionResult>("start_task_session", { taskId: selectedTaskId });
  if (result.success) toast.success("Tracking session started");
  // ...
};
```

#### B. Web Dashboard Trigger (`ActivityTrackingProvider`)
- Preflight: `GET /api/tasks/:id/time-tracking` → check `timerAllowance.limitReached`.
- POST `start` with live counters via `postActivitySessionDetailed`.
- POST `syncTaskTimeTrackingApi(taskId, "start", counters)`.

#### C. Rust Agent IPC & HTTP Request (`session.rs`)
- Sends HTTP `POST` to `{api_url}/api/activity/session`:
```json
{
  "action": "start",
  "taskId": "a1b2c3d4-e5f6-7890-abcd-1234567890ab",
  "activeSeconds": 0,
  "idleSeconds": 0
}
```
> **Stale as of the current uncommitted edits.** `session.rs` no longer hardcodes `activeSeconds: 0` — it now serializes a real `active_seconds` parameter. However, no caller currently supplies live elapsed seconds, and `controller.rs`'s call sites don't pass the new argument at all (compile error) — so the request body above is still what's actually sent once the build is fixed to compile, not yet what real counters look like end-to-end.

#### D. Backend Execution Chain (`activity/routes.js` & `task-time-tracking.js`)
1. **Desktop Link Verification**: Returns `409 Conflict` only when **both** `ACTIVITY_CAPTURE_MODE === "agent"` **and** desktop agent ingest is enabled, and `members.desktop_agent_linked_at` is null.
2. **Timer Allowance Enforcement**: Runs `computeTimerAllowance()` before creating session. If `limitReached === true`, returns `403 Forbidden`.
3. **Database Operations**:
   - Inserts/updates row in Postgres `activity_sessions` (`status = 'active'`).
   - If `activeSeconds` and `idleSeconds` are provided **and** a task id is resolvable (`taskId` from the request, or the open session's `task_id`), calls `syncTaskTimeTracking()` (`activity/routes.js:328`). Without a resolvable task id, sync never fires even if counters are present.
     - Upserts Firestore `tasks/{taskId}/time_tracking/{docId}`.
     - Runs `enforceTimerAllowanceOnSync` → may cap counters.
     - Auto-transitions **assignment** from `todo`/`blocked` → `in_progress`.
     - Calls `aggregateTaskProgress()` → updates task-level totals on Firestore `tasks` doc.
     - Optionally dual-writes `task_member_progress` + `timer_sessions` in Postgres.
4. **Agent Heartbeat**: Desktop agent liveness piggybacks on `GET /api/activity/session` polls (no separate heartbeat when `Origin` header is absent).

---

### Phase 5: Active Session Ticking, Sync & Event Logging

#### A. Local Clock Ticking
- **Tauri agent UI**: increments `liveActiveSeconds` every 1000ms while session status is `active`.
- **Web dashboard**: increments `activeRef` every 1000ms while `phase === "active"`; increments `idleRef` while `phase === "idle"`.

#### B. Periodic Backend Synchronization

| Client | Interval | Endpoints | Writes counters? |
| :--- | :--- | :--- | :--- |
| Tauri agent UI | 5s | `GET /api/activity/session`, `GET /api/tasks/:id/time-tracking` | **No** (read-only poll) |
| Web dashboard | 120s (prod) / 180s (dev) | `POST /api/activity/session` (`sync`) + `POST /api/tasks/:id/time-tracking` (`sync`) | **Yes** |
| Tauri tracker | 5s | `GET /api/activity/session` (session discovery) | N/A |

`ACTIVITY_SESSION_SYNC_MS` (`infrastructure/config/firestore-throttle.ts:9`) governs the counter-sync interval above — much slower than the 5s figure might suggest, deliberately, to limit Firestore writes. Agent-readiness is **not** part of that sync — it's a separate effect (`enforceAgentReady`, `activity-tracking-context.tsx:564-588`) polling every 5s (`AGENT_CHECK_MS`) that pauses the timer to `idle` if the desktop agent disconnects in agent mode.

#### C. Activity Event Logging (`POST /api/activity/events`)
Single batched endpoint — **not** separate `/api/agent/events/*` paths.

```json
{
  "sessionId": "e8f9a0b1-c2d3-4e5f-6a7b-8c9d0e1f2a3b",
  "source": "desktop_agent",
  "events": [
    { "type": "app", "appName": "VS Code", "pageTitle": "controller.rs", "durationSeconds": 15 },
    { "type": "screenshot", "imageData": "...", "appName": "VS Code", "pageTitle": "...", "activityLevel": 42 }
  ]
}
```

- **App/URL logs**: 15s capture slices (`APP_LOG_INTERVAL_SEC`). Same app+tab within **120s grace** (`APP_LOG_MERGE_GRACE_MS`) extends `duration_seconds` on existing row instead of inserting a duplicate.
- **Screenshots**: Stored in `activity_screenshots` (may use GCS `screenshot_url` or inline `image_data` depending on deployment).
- **Offline queue**: Agent queues failed uploads locally; retries every 30s (`QUEUE_FLUSH_INTERVAL_SEC`).
- **Agent quit**: `AgentController::stop()` POSTs `stop` server-side so sessions are not left open and auto-resumed on next sign-in.

#### D. Task Progress Aggregation (`aggregateTaskProgress`)
On every `syncTaskTimeTracking` call:
1. Sums all member `active_seconds` / `idle_seconds` from `tasks/{taskId}/time_tracking`.
2. Updates each member's `progress_percentage`.
3. Writes task-level `total_active_seconds`, `total_idle_seconds`, `aggregated_progress_percent` on the Firestore `tasks` doc.

Progress formula (per member and aggregate):
$$\text{progressPercent} = \begin{cases} \text{null} & \text{if estimatedSeconds} \le 0 \\ \min(100, \text{round}(\frac{\text{activeSeconds}}{\text{estimatedSeconds}} \times 100)) & \text{otherwise} \end{cases}$$

---

### Phase 6: Session Termination (`action = "stop"`)

#### A. Tauri Agent UI Trigger (`App.tsx`)
```typescript
const handleStop = async () => {
  setBusy(true);
  const result = await invoke<ActionResult>("stop_session");
  if (result.success) toast.message("Tracking session paused");
};
```

#### B. Web Dashboard Trigger
`postActivitySession("stop", counters)` → `syncTaskTracking("stop")` → clears session ref, returns to `online` phase.

#### C. Backend Processing Chain
1. **Update Session**: `activity_sessions` → `status = 'stopped'`, `ended_at = NOW()`, updates `active_seconds` / `idle_seconds` from request body.
2. **Sync Task Time Tracking** (when counters provided):
   - Updates Firestore `time_tracking` doc for member.
   - Dual-writes `task_member_progress` + closes open `timer_sessions` row in Postgres.
   - Runs `aggregateTaskProgress`.
3. **Auto-Promote to Review (`maybePromoteTaskToReview`)**:
   - If **aggregate** `totalActiveSeconds` ≥ `estimatedSeconds`:
   - Promotes **assignment** status from `in_progress`/`todo` → `in_review` (not task status directly).
   - Calls `recomputeTaskStatus()` and sends notifications.
4. **Does NOT create `time_entries`** — timesheet rows require explicit manual/API creation via `/api/time-entries`.

---

### Phase 7: Web Dashboard Timer Flow (`ActivityTrackingProvider`)

Summary of web-only behaviors not present in the Tauri agent UI:

1. **Idle detection**: Browser idle watch → auto `idle` action (disabled in agent mode).
2. **Wake lock**: Acquired while `phase === "active"`.
3. **Agent gating**: In agent mode, timer pauses if agent is unavailable (`AGENT_FAIL_PAUSE_THRESHOLD = 1` consecutive failure).
4. **Session poll**: While active/idle, polls `GET /api/activity/session` every 5s; stops after 3 consecutive misses.
5. **Limit reached**: Auto-idles and fires `vt-task-timer-limit-reached` event when local active seconds hit `maxCumulativeActiveSeconds`.
6. **Task switch**: Persists previous task counters to local storage + fire-and-forget `sync` on old task before loading new task state.

---

## 3. End-to-End API Payload Catalog

### 3.1 `GET /api/tasks/{taskId}/time-tracking`

#### Response (`200 OK`):
```json
{
  "success": true,
  "data": {
    "tracking": {
      "id": "...",
      "taskId": "...",
      "userId": "...",
      "activeSeconds": 7200,
      "idleSeconds": 300,
      "startedAt": "2026-07-27T08:00:00.000Z",
      "lastActivityAt": "2026-07-27T10:00:00.000Z",
      "sessionId": "e8f9a0b1-..."
    },
    "activeSeconds": 7200,
    "idleSeconds": 300,
    "taskStatus": "in_progress",
    "assignmentStatus": "in_progress",
    "assignmentId": "...",
    "estimatedSeconds": 28800,
    "overtimeSeconds": 3600,
    "progressPercent": 25,
    "totalActiveSeconds": 14400,
    "totalIdleSeconds": 600,
    "aggregatedProgressPercent": 50,
    "memberContributions": null,
    "timerAllowance": {
      "allowedRemainingSeconds": 18000,
      "maxCumulativeActiveSeconds": 25200,
      "limitReached": false,
      "message": "",
      "taskDailyCapSeconds": 28800,
      "memberDailyLimitSeconds": 28800,
      "memberWeeklyLimitSeconds": 144000,
      "workedTodaySeconds": 14400,
      "workedTodayOnTaskSeconds": 7200,
      "workedWeekSeconds": 36000
    }
  }
}
```

`memberContributions` populated only for management roles when `includeMemberBreakdown` is requested internally.

---

### 3.2 `POST /api/tasks/{taskId}/time-tracking`

Used by the web dashboard for direct task-timer sync (parallel to the piggyback sync inside `POST /api/activity/session`).

#### Request:
```json
{
  "action": "sync",
  "activeSeconds": 7205,
  "idleSeconds": 300,
  "sessionId": "e8f9a0b1-c2d3-4e5f-6a7b-8c9d0e1f2a3b"
}
```

Allowed actions: `start`, `idle`, `resume`, `stop`, `sync`.

#### Response (`200 OK`):
```json
{
  "success": true,
  "data": {
    "tracking": { "...": "..." },
    "activeSeconds": 7205,
    "idleSeconds": 300,
    "taskStatus": "in_progress",
    "assignmentStatus": "in_progress",
    "estimatedSeconds": 28800,
    "progressPercent": 25,
    "totalActiveSeconds": 14405,
    "statusChanged": false,
    "timerAllowance": { "...": "..." },
    "timerCapped": false
  }
}
```

#### Error (`400` when limit reached on start/resume):
```json
{
  "success": false,
  "error": "Maximum allowed work time for this task has been reached."
}
```

---

### 3.3 `POST /api/activity/session`

#### Request Payload:
```json
{
  "action": "start",
  "taskId": "a1b2c3d4-e5f6-7890-abcd-1234567890ab",
  "activeSeconds": 0,
  "idleSeconds": 0
}
```

Allowed actions: `start`, `idle`, `resume`, `stop`, `sync`.

When `activeSeconds` and `idleSeconds` are both provided and a `taskId` is resolvable, the handler also calls `syncTaskTimeTracking` (best-effort; errors logged, do not fail the session response).

#### Response (`200 OK`):
```json
{
  "success": true,
  "data": {
    "id": "e8f9a0b1-c2d3-4e5f-6a7b-8c9d0e1f2a3b",
    "status": "active",
    "taskId": "a1b2c3d4-e5f6-7890-abcd-1234567890ab",
    "activeSeconds": 0,
    "idleSeconds": 0
  }
}
```

#### Error Response (`403 Forbidden` when limit reached):
```json
{
  "success": false,
  "error": "Maximum allowed work time for this task has been reached.",
  "data": {
    "timerAllowance": {
      "limitReached": true,
      "allowedRemainingSeconds": 0,
      "message": "Maximum allowed work time for this task has been reached."
    }
  }
}
```

#### Error Response (`409 Conflict` — agent not linked):
```json
{
  "success": false,
  "error": "Link the Virtual Tracker desktop agent to your account before starting the timer."
}
```

---

### 3.4 `POST /api/activity/events`

See Phase 5 §C. Returns inserted row counts; may return `skipped: "desktop_agent_ingest_disabled"` when ingest is off.

---

### 3.5 `GET /api/task-time-tracking/management`

Management review queue. Returns rows from `getManagementTaskTrackingRows` (needs-review + priority-monitor assignments).

---

### 3.6 `POST /api/tasks/{taskId}/time-tracking/review`

```json
{ "decision": "approve", "notes": "Looks good." }
```

Maps to `reviewAssignment` (`rework` → `reject`). Operates on assignment in `in_review` status.

---

## 4. Operational Summary Flowchart

```
[Task Created in Web PM] ──(Firestore + Postgres mirror)──> [duration_hours_per_day, working_days, dates]
                                                                        │
                                                                        ▼
                              estimateAssignmentSeconds (live from Firestore task doc)
                                                                        │
                    ┌───────────────────────────────────────────────────┴───────────────────────────────────────┐
                    ▼                                                                                           ▼
         [Web Timer — ActivityTrackingProvider]                                          [Tauri Agent UI — App.tsx]
                    │                                                                                           │
         GET /api/tasks/:id/time-tracking                                               GET /api/tasks/:id/time-tracking
         (preflight allowance)                                                          (preflight allowance)
                    │                                                                                           │
         POST /api/activity/session (start + counters)                                  POST /api/activity/session (start, counters=0)
         POST /api/tasks/:id/time-tracking (start)                                      (no task-time-tracking sync with counters)
                    │                                                                                           │
                    ├──── 1s local tick + 5s POST sync (writes counters) ────┐                                  │
                    │                                                         │                                  │
                    └─────────────────────────────────────────────────────────┼──────────────────────────────────┘
                                                                              ▼
                                                         [activity_sessions ACTIVE in Postgres]
                                                                              │
                              ┌───────────────────────────────────────────────┴───────────────────────────────────────────────┐
                              ▼                                                                                               ▼
               [Web: POST sync every 5s]                                                              [Tauri ActivityTracker]
               activity_sessions + Firestore time_tracking                                            POST /api/activity/events
               + optional PG dual-write                                                               (screenshots, app, URL logs)
                              │                                                                                               │
                              ▼                                                                                               │
               [User Clicks Stop / Agent Quit]                                                                                │
               POST stop + final syncTaskTimeTracking                                                                         │
                              │                                                                                               │
                              ├─> Update task_member_progress (PG dual-write)                                                 │
                              ├─> aggregateTaskProgress → task totals on Firestore                                           │
                              ├─> maybePromoteTaskToReview → assignment → in_review                                         │
                              └─> (NO automatic time_entries row)                                                           │
```

---

## 5. Known Gaps & Roadmap

| Gap | Current behavior | Likely fix |
| :--- | :--- | :--- |
| Agent counter sync | Mid-fix, uncommitted, **and currently broken**: `session.rs` now accepts a real `active_seconds` param, but `controller.rs`'s 3 call sites (lines 84, 320, 339) still call the old 2-arg signature — the crate does not compile. `App.tsx` also doesn't yet pass `liveActiveSeconds` into `invoke("start_task_session", …)`. No periodic `sync` action exists yet. | Update `controller.rs` call sites to pass `active_seconds`, thread `liveActiveSeconds` through the Tauri command from `App.tsx`, and add a periodic `sync` action (every 5s) matching the web client |
| `time_entries` on stop | Not implemented | Explicit conversion job or stop-handler if timesheet auto-fill is desired |
| Agent-only progress | Task `time_tracking` docs stay at 0 if user never uses web timer | Depends on agent counter sync above |
| `timer_sessions.source` | Dual-write always passes `source: "web"` from `syncTaskTimeTracking` | Pass `desktop_agent` when sync originates from agent |

---
