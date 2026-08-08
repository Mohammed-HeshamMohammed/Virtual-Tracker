# Relational / SQL Table Names

Quick-reference of every **PostgreSQL** table used by the Dashboard-Backend service. Schema is
applied at boot by `src/lib/postgres/ensure-lookup-schema.js` (the real source of truth — `schema.sql`
lags behind it; see that file's own header comment). Single-tenant deployment throughout: no
`organizations`/`tenant` table exists anywhere in this schema, so any "global" or "singleton" table
below means one row for the whole deployment, not one per org.

---

## PostgreSQL Tables

### 1. Transactional & Log Data
High-frequency transaction tables — timesheets, activity logs, and hourly records synced or written directly.

| Table Name     | Primary Key | Description                                                                 |
| :------------- | :---------- | :-------------------------------------------------------------------------- |
| `time_entries` | `UUID` (PK) | Individual logged time segments containing project, task, duration, and status. |
| `timesheets`   | `UUID` (PK) | Period-based timesheet aggregations submitted by members for approval.       |
| `notifications` | `UUID` (PK) | In-app dashboard notifications served in the system bell panel. Moved off Firestore. |
| `activity_screenshots` | `UUID` (PK) | Desktop-agent screenshots stored as `bytea` (`image_data`), plus per-capture raw signal counters (keystrokes, mouse distance, injected-input count) and a `perceptual_hash` used by the integrity sweep. Rows older than 7 days have their image data archived to GCS individually (`screenshot_url` set, `image_data` cleared); fully-archived rows older than 90 days are deleted (`scripts/archive-screenshots.mjs`, run manually or on a schedule). |
| `apps`         | `UUID` (PK) | Shared app-name dimension — one row per distinct app name across every member, referenced by `activity_app_logs.app_id` instead of repeating the text. |
| `activity_app_logs` | `UUID` (PK) | Logged active desktop apps per tracking frame, `app_id → apps(id)`. Moved off Firestore. |
| `activity_url_logs` | `UUID` (PK) | Browser domain/URL logs per tracking frame. Moved off Firestore. |
| `activity_sessions` | `UUID` (PK) | Active/idle/stopped tracking sessions per member, with active/idle second tallies. A partial unique index (`activity_sessions_one_open_per_member`) guarantees at most one open session per member even under a start/resume race. Moved off Firestore. |
| `activity_integrity_flags` | `UUID` (PK) | Durable, contestable record of what the integrity sweep flagged per session (screenshot staleness, category conflict, injected input) — `UNIQUE (session_id, flag_type)` so the sweep can't spam duplicates. |
| `activity_alert_log` | `UUID` (PK) | Cooldown-deduped record of low-activity/missing-screenshot alerts sent. Moved off Firestore. |
| `daily_member_active_seconds` | `(member_id, day)` (PK) | Delta-attributed daily active-seconds rollup — fixes the midnight-crossing bug a raw session-range sum had. |
| `daily_member_task_active_seconds` | `(member_id, task_id, day)` (PK) | Same rollup, scoped per task — backs the daily per-task allowance cap. |

### 2. Synchronized Lookup Tables
Relational representation of organization options, roles, and categories.

| Table Name          | Primary Key | Description                                                                                 |
| :------------------ | :---------- | :------------------------------------------------------------------------------------------ |
| `roles`             | `UUID` (PK) | System roles (Owner, Admin, Manager, etc.) with unique names and descriptions. Read exclusively through `loadRoleNameById` / `resolveRoleIdsWhere` / `resolveRoleNameById` (`relation-sync.js`) — nothing writes to the old Firestore `roles` collection anymore. |
| `lookup_tables`     | `UUID` (PK) | Categorized options (`job_title`, `department`, `job_type`, `tax_type`) mapped to list priorities. |
| `org_field_options` | `UUID` (PK) | Standard organizational form select lists (e.g. workplace model, termination reasons).       |

### 3. Member Sub-Records (Source of Truth: SQL)
The `members` identity record itself stays in Firestore (see NONSQL-TableNames.md) — these are its
per-member satellite tables, migrated to Postgres piecemeal, one member-detail form section at a time.

| Table Name        | Primary Key | Description |
| :----------------- | :---------- | :----------- |
| `employment`       | `UUID` (PK), unique on `member_id` | Job title/department/tax-type refs, work address, employment type, workplace model, in-office/remote split, start/end dates, termination reason. |
| `pay_rates`        | `UUID` (PK), unique on `member_id` | Hourly/salary pay rate, currency, pay period, timesheet-approval requirement. |
| `time_settings`    | `UUID` (PK), unique on `member_id` | Per-member tracking config: able-to-track, idle-time handling, manual-edit policy, approval requirement, work days, shift-based limits toggle. |
| `limits`           | `member_id` (PK) | Consolidated daily/weekly tracking hour caps. |
| `member_onboarding` | `UUID` (PK) | Checklist tracking onboarding milestones (account created, app downloaded, first time tracked) for new members. |
| `member_bans`      | `UUID` (PK) | Ban records — reason, IP, who banned/revoked, email-sent flag. Partial indexes on `active = true` for email/member/Firebase-UID lookups. |
| `device_bans`      | `ip_address` (PK) | Per-IP ban counters and permanently-banned flag, keyed by IP rather than member. |
| `member_tree_cache` | `member_id` (PK) | Flattened ancestor/descendant JSONB arrays for O(1) hierarchy-tree reads, plus `root_id`/`depth`. |

### 4. Projects, Clients & Teams Domain (migrated from Firestore — see `PROPOSAL-Projects-Migration-to-PostgreSQL.md`)
Column sets pulled from the live Firestore field catalogs (`src/modules/schema/catalog/{projects,clients,teams}/index.js`)
at migration time, not invented. `projects`/`clients` are canonical SQL rows; `team_projects` links to
a team that is *not* itself in SQL (teams stay in Firestore, see NONSQL doc), so `team_id` on that
table carries no FK — cleanup on team delete is an explicit application-code step
(`deleteTeamProjectsForTeamPg`, `src/lib/postgres/projects-postgres.service.js`), not a cascade.

| Table Name          | Primary Key | Description |
| :------------------- | :---------- | :----------- |
| `projects`           | `UUID` (PK) | Canonical project record — name, status (`active`/`paused`/`archived`), billable/activity/idle-time flags, `type` (`normal`/`calling`), client link, notes. Optimistic-concurrency `updated_at` check on write (see `updateProjectPg`/`archiveProjectPg`); a write racing a stale snapshot returns `{ conflict: true }` rather than silently overwriting. Every create/update/delete publishes a `projects` change event via `publishChange` (`src/modules/realtime/change-bus.js`). |
| `project_members`    | `UUID` (PK) | Member role (`manager`/`user`/`viewer`) per project. `ON DELETE CASCADE` from `projects`. |
| `project_budgets`    | `UUID` (PK), unique on `project_id` | Cost/hours budget, `per_project`/`per_person` scope, notify/stop-timer thresholds, reset cadence. `ON DELETE CASCADE` from `projects`. |
| `project_budget_notify_state` | `project_id` (PK) | Dedupe state for the budget notify-threshold check — which reset period a notification already went out for. |
| `project_member_limits` | `UUID` (PK) | Per-member budget cap scoped to a project. `ON DELETE CASCADE` from `projects`. |
| `clients`             | `UUID` (PK) | Billed client account — address, contact info, status (`active`/`archived`). |
| `client_budgets`      | `UUID` (PK), unique on `client_id` | Client-level budget (`hourly`/`fixed`/`retainer`/`none`), a deliberately separate vocabulary from `project_budgets`' own. `ON DELETE CASCADE` from `clients`. |
| `client_invoicing`    | `UUID` (PK), unique on `client_id` | Net terms, tax rate, auto-invoicing config (frequency, line-item detail, delay/reminder days). `ON DELETE CASCADE` from `clients`. |
| `client_automation_state` | `client_id` (PK) | Dedupe state for client budget notifications — replaces the old Firestore `client_automation_state` collection. `ON DELETE CASCADE` from `clients`. |
| `client_projects`    | `UUID` (PK) | Client ↔ project links. `ON DELETE CASCADE` from `projects` and (via a follow-up `ALTER`) from `clients`. |
| `team_projects`      | `UUID` (PK) | Team ↔ project links. `ON DELETE CASCADE` from `projects` only — `team_id` has no FK (teams are Firestore); deleting a team must explicitly call `deleteTeamProjectsForTeamPg`. |

### 5. Tasks & Time Tracking Domain (`implementation.md` Phase 2 — moved off Firestore)

| Table Name | Primary Key | Description |
| :--------- | :---------- | :----------- |
| `tasks` | `UUID` (PK) | Project work items — title, status, priority, schedule (`duration_hours_per_day`/`working_days`/`duration_days`), assignee, and rolled-up progress totals. |
| `task_assignments` | `UUID` (PK) | Links members to tasks with expected duration and review state. `ON DELETE CASCADE` from `tasks`. |
| `task_member_progress` | `UUID` (PK) | Per-member live timer counters for a task (active/idle seconds, progress percent) — the primary time-tracking store, not a Firestore mirror. `ON DELETE CASCADE` from `tasks`. |
| `daily_member_active_seconds` | see §1 | listed once, under Transactional & Log Data |
| `daily_member_task_active_seconds` | see §1 | listed once, under Transactional & Log Data |

Task **subcollections** (comments, subtasks, attachments, hours) are deliberately *not* in this list —
they remain Firestore-resident by explicit design; see NONSQL-TableNames.md.

### 6. Compliance & Monitoring Config
Added for the consent/data-minimization/retention feature set. Every table here is either a global
singleton row or a small admin-tunable set — none of it is per-member volume data.

| Table Name | Primary Key | Description |
| :--------- | :---------- | :----------- |
| `monitoring_capabilities` | `capability` (PK) | Per-capability (`screenshots`, `app_tracking`, `url_capture`, `activity_metering`, `dns_logging`, `integrity_signals`) enabled flag, jurisdiction profile, lawful basis. Default-deny: no row or `enabled = false` means never captured. |
| `monitoring_policy_audit` | `UUID` (PK) | Append-only audit trail of every capability enable/disable — who, when, previous/new state, lawful basis. Application-layer append-only (no DB-role enforcement). |
| `member_monitoring_consent` | `member_id` (PK) | Per-member disclosure/consent timestamps and the notice version they consented to — bumping the version invalidates prior consent. |
| `capture_exclusions` | `UUID` (PK) | Global list of apps/domains that must never be captured — enforced at ingest, not blurred or logged. Case-insensitive unique on `(match_type, pattern)`. |
| `capture_minimization_settings` | `id = 1` (singleton) | URL-domain-only stripping and default screenshot-blur toggles. |
| `data_retention_settings` | `data_type` (PK) | Per-data-type (`screenshots`/`app_logs`/`url_logs`/`sessions`) retention-day ceiling. No "never delete" option by design. |
| `screenshot_access_log` | `UUID` (PK) | Append-only log of every read of raw screenshot data — who viewed whose screenshot, when. |
| `activity_scoring_settings` | `id = 1` (singleton) | Server-tunable activity-score constants (saturation events, window, idle thresholds, screenshot cadence) — overrides values that used to be hardcoded in the Rust agent. |
| `activity_categories` | `UUID` (PK) | App/domain → productivity category (`productive`/`neutral`/`distracting`/`unclassified`) map, with an optional per-role override and a display-name the frontend and the Rust agent both consume — the single source that replaced two independently-drifting hardcoded lists. Seeded with a large default set on boot, never overwritten once an admin edits a row (`ON CONFLICT DO NOTHING`). |

### 7. Desktop Agent

| Table Name | Primary Key | Description |
| :--------- | :---------- | :----------- |
| `agent_link_sessions` | `link_token` (PK) | Short-lived browser-to-agent link handshake state (pending/completed/exchanged), holds a borrowed Firebase token pair during the link flow. |
| `agent_devices` | `device_id` (PK) | Long-lived per-machine agent credential (hashed secret) so a linked device can re-authenticate without a browser round-trip. Also carries device ownership (`company`/`personal`/`unspecified`) and VM-detection signals for the integrity review flow — the latter is deliberately a reviewable flag surfaced to a manager, never an automatic verdict. |

### 8. Reports

| Table Name | Primary Key | Description |
| :--------- | :---------- | :----------- |
| `report_schedules` | `UUID` (PK) | Recurring report deliveries — type, recipient emails, file format, date-range kind, frequency, delivery time, last-sent tracking. |

### 9. System

| Table Name | Primary Key | Description |
| :--------- | :---------- | :----------- |
| `system_meta` | `doc_key` (PK) | Migration status markers and small keyed JSON payloads. Moved off Firestore — the NoSQL doc's older "System" section describing this as Firestore-resident is stale. |

---

## Detailed Table Schemas

Full column detail for the tables most frequently touched by application code. Every other table's
column set is summarized in the tables above; read `ensure-lookup-schema.js` directly for the exact
DDL if you need more.

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
- **Constraints**: `name` is `UNIQUE` (no separate index needed — the unique constraint already backs one)

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
- **Purpose**: Project work items — the canonical task record.
- **Schema Fields**:
  - `id`: `UUID` (Primary Key, defaults to `gen_random_uuid()`)
  - `project_id`: `UUID` (Not Null, `REFERENCES projects(id)`)
  - `team_id`, `title`, `description`, `status` (default `todo`), `priority`, `order_index`
  - `duration_hours_per_day`, `duration_days`, `working_days`, `overtime_hours_per_day`
  - `assigned_to`: `UUID` (primary assignee, soft reference — members stay in Firestore)
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
  - `member_id`: `UUID` (Not Null — renamed from `user_id`, implementation.md Phase 4.4, to match every other table's convention)
  - `project_id`: `UUID` (Not Null, `REFERENCES projects(id)`)
  - `status` (default `todo`), `expected_seconds`, `required`, `review_state`, `reviewed_by`, `reviewed_at`, `review_notes`, `entered_review_at`
  - `created_at`, `updated_at`
- **Constraints**: `UNIQUE (task_id, member_id)`
- **Indexes**: `idx_task_assignments_user` ON `(member_id)`, `idx_task_assignments_project` ON `(project_id)`

### 9. `task_member_progress`
- **Purpose**: Live per-member timer state for a task — the primary store for time tracking (not a Firestore mirror).
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
- **View**: `task_progress_aggregate` — `SUM(active_seconds)`/`SUM(idle_seconds)`/`COUNT(DISTINCT member_id)` grouped by `task_id`.

### 10. `daily_member_active_seconds` / `daily_member_task_active_seconds`
- **Purpose**: Fix a real correctness bug (implementation.md Phase 4.6) — summing a session's active_seconds by its `started_at` attributed a session that crossed midnight entirely to the day it started. These are incremented by delta (this sync's `active_seconds` minus the session's previous value) attributed to the calendar day the sync actually ran on, sidestepping the midnight split.
- **Schema Fields** (`daily_member_active_seconds`): `member_id`, `day` (`DATE`), `active_seconds`, `updated_at` — `PRIMARY KEY (member_id, day)`
- **Schema Fields** (`daily_member_task_active_seconds`): same, plus `task_id` — `PRIMARY KEY (member_id, task_id, day)`
- **Consumers**: `computeTimerAllowance()` (`timer-limit.service.js`) reads these for `workedTodaySeconds`/`workedTodayOnTaskSeconds`/`workedWeekSeconds`, the numbers that gate daily/weekly timer caps.

### 11. `projects`
- **Purpose**: Canonical project record — the authoritative store, not a Firestore mirror.
- **Schema Fields**:
  - `id`: `UUID` (Primary Key)
  - `name`, `status` (`active`/`paused`/`archived`), `billable`, `disable_activity`, `allow_project_tracking`, `disable_idle_time`, `idle_time_seconds` (default `450`)
  - `client_id`: `UUID` (nullable, soft reference)
  - `managers_notes`, `users_notes`, `viewers_notes`
  - `type` (`normal`/`calling`), `end_date`
  - `created_at`, `updated_at`, `created_by`, `updated_by`, `archived_by`, `archived_at`
- **Concurrency**: `updateProjectPg`/`archiveProjectPg` accept an optional `expectedUpdatedAt`. When passed, the `UPDATE` is conditioned on `updated_at = expectedUpdatedAt`; zero rows affected means someone else wrote first, and the call returns `{ conflict: true, current }` instead of silently overwriting.
- **Change events**: every create/update/delete calls `publishChange("projects", id, action, actorId)` (`src/modules/realtime/change-bus.js`) — a signal-only broadcast (no row data) that connected clients use to know when to refetch.
- **Indexes**: `idx_projects_status`, `idx_projects_updated` ON `(updated_at DESC)`, `idx_projects_client`

### 12. `project_members` / `project_budgets` / `project_member_limits`
- **`project_members`**: `id` PK, `project_id → projects(id) ON DELETE CASCADE`, `member_id`, `project_role` (`manager`/`user`/`viewer`), `assigned_at`, `assigned_by`, `updated_by`. `UNIQUE (project_id, member_id)`.
- **`project_budgets`**: `id` PK, `project_id → projects(id) ON DELETE CASCADE` (unique — one budget row per project), `type` (`Cost based`/`Hours based`), `based_on`, `scope` (`per_project`/`per_person`), `cost`, notify/stop-timer thresholds and percentages, `resets` (`Never`/`Weekly`/`Monthly`), `start_date`, `include_non_billable_time`. Companion `project_budget_notify_state` table (PK `project_id`) tracks which reset period a notify-threshold email already went out for.
- **`project_member_limits`**: `id` PK, `project_id → projects(id) ON DELETE CASCADE`, `member_id`, same budget-shape fields as `project_budgets` but scoped to one member. `UNIQUE (project_id, member_id)`.

### 13. `clients`, `client_budgets`, `client_invoicing`, `client_projects`
- **`clients`**: `id` PK, `member_id` (soft reference, the client's own contact), `name`, address fields, `phone_number`, `email_addresses`, `status` (`active`/`archived`).
- **`client_budgets`**: `id` PK, `client_id → clients(id) ON DELETE CASCADE` (unique), `type` (`hourly`/`fixed`/`retainer`/`none`), `based_on` (`per_person`/`per_project`/`total`), `cost`, `notify_at_pct`, `resets` (`monthly`/`quarterly`/`yearly`/`never`). A deliberately separate vocabulary from `project_budgets` — not unified during the migration.
- **`client_invoicing`**: `id` PK, `client_id → clients(id) ON DELETE CASCADE` (unique), net terms, tax rate, auto-invoicing frequency/amount-basis/line-item detail, delay/reminder days.
- **`client_automation_state`**: `client_id` PK, `budget_policy` JSONB, notify/period-key dedupe state — replaced the old Firestore `client_automation_state` collection.
- **`client_projects`**: `id` PK, `client_id`, `project_id → projects(id) ON DELETE CASCADE`. `UNIQUE (client_id, project_id)`. `client_id` gained its own FK to `clients(id) ON DELETE CASCADE` in a follow-up `ALTER` once the `clients` table existed.

### 14. `team_projects`
- **Purpose**: Team ↔ project visibility links. The one table in this domain with a genuine gap in its
  own foreign-key coverage: `project_id → projects(id) ON DELETE CASCADE` cleans up automatically when
  a project is deleted, but `team_id` carries **no FK at all** — the team itself is a Firestore
  document, and Postgres cannot reference across storage engines.
- **Consequence**: deleting a team must explicitly clean up its `team_projects` rows in application
  code. That cleanup was missing for a period (the handler deleted a stale Firestore mirror of this
  table instead of the real Postgres rows, permanently orphaning them) and was fixed by adding
  `deleteTeamProjectsForTeamPg(teamId)` (`src/lib/postgres/projects-postgres.service.js`), called from
  the `DELETE /api/teams/:id` handler (`src/modules/schema/routes.js`) alongside the existing
  Firestore `team_members` cleanup.
- **Schema Fields**: `id` PK, `team_id`, `project_id`, `assigned_at`, `assigned_by`. `UNIQUE (team_id, project_id)`.

### 15. `agent_devices`
- **Purpose**: Long-lived per-machine credential for the desktop agent, so a linked device can
  re-authenticate without a browser round-trip once its borrowed Firebase refresh token dies.
- **Schema Fields**: `device_id` PK, `member_id`, `secret_hash` (never stored plaintext), `agent_source`, `failed_attempts`, `last_seen_at`, `revoked_at`, `ownership` (`company`/`personal`/`unspecified`) with `ownership_set_by`/`ownership_set_at`, `vm_detected`/`vm_signals`/`vm_detected_at` (a reviewable signal for a manager, never an automatic verdict).
- **Indexes**: `idx_agent_devices_member` ON `(member_id)` WHERE `revoked_at IS NULL`
