# Relational / SQL Table Names

Quick-reference of every **PostgreSQL** table used by the Dashboard-Backend service for timesheet transactions and static lookup synchronization.

---

## PostgreSQL Tables

These tables are created and managed in the PostgreSQL database (typically `virtual_tracker`).

### 1. Transactional & Log Data
High-frequency transaction tables. These house timesheets, logs, and hourly records synced or written directly.

| Table Name     | Primary Key | Description                                                                 |
| :------------- | :---------- | :-------------------------------------------------------------------------- |
| `time_entries` | `UUID` (PK) | Individual logged time segments containing project, task, duration, and status. |
| `timesheets`   | `UUID` (PK) | Period-based timesheet aggregations submitted by members for approval.       |
| `notifications` | `UUID` (PK) | In-app dashboard notifications served in the system bell panel. Moved off Firestore. |
| `activity_screenshots` | `UUID` (PK) | Desktop-agent screenshots stored as `bytea` (`image_data`). Rows older than 7 days have their image data archived to GCS individually (`screenshot_url` set, `image_data` cleared); fully-archived rows older than 90 days are deleted (`scripts/archive-screenshots.mjs`, run manually or on a schedule). |
| `activity_app_logs` | `UUID` (PK) | Logged active desktop apps per tracking frame. Moved off Firestore. |
| `activity_url_logs` | `UUID` (PK) | Browser domain/URL logs per tracking frame. Moved off Firestore. |
| `activity_sessions` | `UUID` (PK) | Active/idle/stopped tracking sessions per member, with active/idle second tallies. Moved off Firestore. |
| `activity_alert_log` | `UUID` (PK) | Cooldown-deduped record of low-activity/missing-screenshot alerts sent. Moved off Firestore. |

### 2. Synchronized Lookup Tables
Relational representation of organization options, roles, and categories.

| Table Name          | Primary Key | Description                                                                                 |
| :------------------ | :---------- | :------------------------------------------------------------------------------------------ |
| `roles`             | `UUID` (PK) | System roles (Owner, Admin, Manager, etc.) with unique names and descriptions.              |
| `lookup_tables`     | `UUID` (PK) | Categorized options (`job_title`, `department`, `job_type`, `tax_type`) mapped to list priorities. |
| `org_field_options` | `UUID` (PK) | Standard organizational form select lists (e.g. workplace model, termination reasons).       |

### 3. Tasks & Time Tracking Domain (implementation.md Phase 2 - moved off Firestore)

| Table Name | Primary Key | Description |
| :--------- | :---------- | :----------- |
| `tasks` | `UUID` (PK) | Project work items - title, status, priority, schedule, assignee, and rolled-up progress totals. |
| `task_assignments` | `UUID` (PK) | Links members to tasks with expected duration and review state. |
| `task_member_progress` | `UUID` (PK) | Per-member live timer counters for a task (active/idle seconds, progress percent). |
| `daily_member_active_seconds` | `(member_id, day)` (PK) | Delta-attributed daily active-seconds rollup, fixes the midnight-crossing bug a raw session-range sum had. |
| `daily_member_task_active_seconds` | `(member_id, task_id, day)` (PK) | Same rollup, scoped per task - backs the daily per-task allowance cap. |

Note: `projects`, `project_members`, `project_budgets`, `project_member_limits`, `client_projects`, and `team_projects` also moved to PostgreSQL, in an earlier migration that predates this doc section - not listed here since this doc hasn't been extended to cover them yet.

---

## Detailed Table Schemas

### 1. `time_entries`
- **Purpose**: Stores individual tracking logs for activities.
- **Schema Fields**:
  - `id`: `UUID` (Primary Key, defaults to `gen_random_uuid()`)
  - `member_id`: `UUID` (Not Null)
  - `project_id`: `UUID` (Not Null)
  - `task_id`: `UUID` (Nullable)
  - `date`: `DATE` (Not Null)
  - `start_time`: `TIME`
  - `end_time`: `TIME`
  - `duration`: `INTEGER` (Not Null, default `0`)
  - `description`: `TEXT`
  - `billable`: `BOOLEAN` (Not Null, default `false`)
  - `status`: `VARCHAR(20)` (Must be `pending`, `approved`, or `rejected`)
  - `created_by`: `VARCHAR(255)`
  - `updated_by`: `VARCHAR(255)`
  - `created_at`: `TIMESTAMPTZ` (Not Null, default `now()`)
  - `updated_at`: `TIMESTAMPTZ` (Not Null, default `now()`)
- **Indexes**:
  - `idx_te_member_date` ON `(member_id, date DESC)`
  - `idx_te_project_date` ON `(project_id, date DESC)`
  - `idx_te_member_project` ON `(member_id, project_id)`
  - `idx_te_task` ON `(task_id)` WHERE `task_id IS NOT NULL`
  - `idx_te_status` ON `(status)`
  - `idx_te_date_range` ON `(date)`

### 2. `timesheets`
- **Purpose**: Bundled billing periods for admin payroll sign-off.
- **Schema Fields**:
  - `id`: `UUID` (Primary Key, defaults to `gen_random_uuid()`)
  - `member_id`: `UUID` (Not Null)
  - `period_start`: `DATE` (Not Null)
  - `period_end`: `DATE` (Not Null)
  - `status`: `VARCHAR(20)` (Must be `draft`, `submitted`, `approved`, or `rejected`)
  - `total_hours`: `NUMERIC(8,2)`
  - `billable_hours`: `NUMERIC(8,2)`
  - `submitted_at`: `TIMESTAMPTZ`
  - `approved_at`: `TIMESTAMPTZ`
  - `approved_by`: `VARCHAR(255)`
  - `created_at`: `TIMESTAMPTZ` (Not Null, default `now()`)
  - `updated_at`: `TIMESTAMPTZ` (Not Null, default `now()`)
- **Constraints**:
  - Unique constraint `uq_timesheet_member_period` on `(member_id, period_start, period_end)`
- **Indexes**:
  - `idx_ts_member` ON `(member_id)`
  - `idx_ts_period` ON `(period_start, period_end)`
  - `idx_ts_status` ON `(status)`
  - `idx_ts_member_status` ON `(member_id, status)`
  - `idx_ts_approved_by` ON `(approved_by)` WHERE `approved_by IS NOT NULL`

### 3. `notifications`
- **Purpose**: In-app notifications delivered to a member (task assignments, transfer requests, budget alerts, etc.).
- **Schema Fields**:
  - `id`: `UUID` (Primary Key, defaults to `gen_random_uuid()`)
  - `recipient_id`: `UUID` (Not Null)
  - `type`: `VARCHAR(60)` (Not Null, default `system`)
  - `title`: `VARCHAR(300)` (Not Null)
  - `message`: `TEXT` (Not Null)
  - `link`: `TEXT` (Not Null, default `''`)
  - `read`: `BOOLEAN` (Not Null, default `false`)
  - `created_at`: `TIMESTAMPTZ` (Not Null, default `now()`)
- **Indexes**:
  - `idx_notif_recipient_created` ON `(recipient_id, created_at DESC)`
  - `idx_notif_recipient_unread` ON `(recipient_id, read)` WHERE `read = false`

### 4. `roles`
- **Purpose**: Tracks platform authorization levels.
- **Schema Fields**:
  - `id`: `UUID` (Primary Key, defaults to `gen_random_uuid()`)
  - `name`: `VARCHAR(60)` (Not Null, Unique)
  - `description`: `TEXT`
  - `created_at`: `TIMESTAMPTZ` (Not Null, default `now()`)
  - `created_by`: `VARCHAR(255)`
  - `updated_by`: `VARCHAR(255)`
  - `updated_at`: `TIMESTAMPTZ` (Not Null, default `now()`)
- **Constraints**: `name` is `UNIQUE` (no separate index needed - the unique constraint already backs one)

### 5. `lookup_tables`
- **Purpose**: System constants for lookup settings.
- **Schema Fields**:
  - `id`: `UUID` (Primary Key, defaults to `gen_random_uuid()`)
  - `category`: `VARCHAR(20)` (Check constraint: `job_title`, `department`, `job_type`, `tax_type`)
  - `name`: `VARCHAR(120)` (Not Null)
  - `list_ranking`: `VARCHAR(20)`
  - `created_at`: `TIMESTAMPTZ` (Not Null, default `now()`)
  - `created_by`: `VARCHAR(255)`
  - `updated_by`: `VARCHAR(255)`
  - `updated_at`: `TIMESTAMPTZ` (Not Null, default `now()`)
- **Constraints**:
  - Unique constraint `uq_lookup_category_name` on `(category, name)`
- **Indexes**:
  - `idx_lookup_category` ON `(category, list_ranking)`

### 6. `org_field_options`
- **Purpose**: Extra configuration tags for standard drops.
- **Schema Fields**:
  - `id`: `UUID` (Primary Key, defaults to `gen_random_uuid()`)
  - `type`: `VARCHAR(30)` (Check constraint: `jobTitle`, `department`, `jobType`, `employmentType`, `employedThrough`, `workplaceModel`, `taxType`, `terminationReason`)
  - `label`: `VARCHAR(120)` (Not Null)
  - `position`: `INT` (Not Null, default `0`)
  - `created_at`: `TIMESTAMPTZ` (Not Null, default `now()`)
  - `updated_at`: `TIMESTAMPTZ` (Not Null, default `now()`)
  - `modified_by`: `VARCHAR(120)`
- **Constraints**:
  - Unique constraint `uq_org_field_type_label` on `(type, label)`
- **Indexes**:
  - `idx_org_field_type` ON `(type, position)`

### 7. `tasks`
- **Purpose**: Project work items - the canonical task record.
- **Schema Fields**:
  - `id`: `UUID` (Primary Key, defaults to `gen_random_uuid()`)
  - `project_id`: `UUID` (Not Null, `REFERENCES projects(id)`)
  - `team_id`, `title`, `description`, `status` (default `todo`), `priority`, `order_index`
  - `duration_hours_per_day`, `duration_days`, `working_days`, `overtime_hours_per_day`
  - `assigned_to`: `UUID` (primary assignee, soft reference - members stay in Firestore)
  - `start_date`, `due_date`, `review_state`, `reviewed_by`, `reviewed_at`
  - `total_active_seconds`, `total_idle_seconds`, `aggregated_progress_percent` (trigger-maintained, see `task_member_progress` below)
  - `completed`, `total_assignees`, `started_assignees`, `not_started_assignees`, `participation_percent`, `all_assignees_started` (participation counters, recomputed by `recomputeTaskStatus()`)
  - `created_at`, `updated_at`, `created_by`, `updated_by`
- **Indexes**: `idx_tasks_status`, `idx_tasks_assigned_status` ON `(assigned_to, status)`, `idx_tasks_project_status` ON `(project_id, status)`

### 8. `task_assignments`
- **Purpose**: Links a member to a task with its own expected duration and review lifecycle, independent of the task's own `assigned_to`.
- **Schema Fields**:
  - `id`: `UUID` (Primary Key)
  - `task_id`: `UUID` (Not Null, `REFERENCES tasks(id) ON DELETE CASCADE`)
  - `member_id`: `UUID` (Not Null - renamed from `user_id`, implementation.md Phase 4.4, to match every other table's convention)
  - `project_id`: `UUID` (Not Null, `REFERENCES projects(id)`)
  - `status` (default `todo`), `expected_seconds`, `required`, `review_state`, `reviewed_by`, `reviewed_at`, `review_notes`, `entered_review_at`
  - `created_at`, `updated_at`
- **Constraints**: `UNIQUE (task_id, member_id)`
- **Indexes**: `idx_task_assignments_user` ON `(member_id)`, `idx_task_assignments_project` ON `(project_id)`

### 9. `task_member_progress`
- **Purpose**: Live per-member timer state for a task - the primary store for time tracking (not a Firestore mirror).
- **Schema Fields**:
  - `id`: `UUID` (Primary Key)
  - `task_id`: `UUID` (Not Null, `REFERENCES tasks(id) ON DELETE CASCADE`)
  - `member_id`: `UUID` (Not Null)
  - `project_id`: `UUID` (nullable, `REFERENCES projects(id)`)
  - `active_seconds`, `idle_seconds`, `progress_percentage`, `last_started_at`, `last_activity_at`, `session_id`, `review_notes`
  - `created_at`, `updated_at`
- **Constraints**: `UNIQUE (task_id, member_id)`
- **Indexes**: `idx_tmp_task_id`, `idx_tmp_member_id`
- **Trigger**: `trg_recompute_task_totals` (AFTER INSERT/UPDATE/DELETE) keeps `tasks.total_active_seconds`/`total_idle_seconds` in sync without relying on application code to call back into `tasks` (implementation.md Phase 4.8).
- **View**: `task_progress_aggregate` - `SUM(active_seconds)`/`SUM(idle_seconds)`/`COUNT(DISTINCT member_id)` grouped by `task_id`.

### 10. `daily_member_active_seconds` / `daily_member_task_active_seconds`
- **Purpose**: Fix a real correctness bug (implementation.md Phase 4.6) - summing a session's active_seconds by its `started_at` attributed a session that crossed midnight entirely to the day it started. These are incremented by delta (this sync's `active_seconds` minus the session's previous value) attributed to the calendar day the sync actually ran on, sidestepping the midnight split.
- **Schema Fields** (`daily_member_active_seconds`): `member_id`, `day` (`DATE`), `active_seconds`, `updated_at` - `PRIMARY KEY (member_id, day)`
- **Schema Fields** (`daily_member_task_active_seconds`): same, plus `task_id` - `PRIMARY KEY (member_id, task_id, day)`
- **Consumers**: `computeTimerAllowance()` (`timer-limit.service.js`) reads these for `workedTodaySeconds`/`workedTodayOnTaskSeconds`/`workedWeekSeconds`, the numbers that gate daily/weekly timer caps.
