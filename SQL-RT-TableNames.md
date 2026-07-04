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

### 2. Synchronized Lookup Tables
Relational representation of organization options, roles, and categories.

| Table Name          | Primary Key | Description                                                                                 |
| :------------------ | :---------- | :------------------------------------------------------------------------------------------ |
| `roles`             | `UUID` (PK) | System roles (Owner, Admin, Manager, etc.) with unique names and descriptions.              |
| `lookup_tables`     | `UUID` (PK) | Categorized options (`job_title`, `department`, `job_type`, `tax_type`) mapped to list priorities. |
| `org_field_options` | `UUID` (PK) | Standard organizational form select lists (e.g. workplace model, termination reasons).       |

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

### 3. `roles`
- **Purpose**: Tracks platform authorization levels.
- **Schema Fields**:
  - `id`: `UUID` (Primary Key, defaults to `gen_random_uuid()`)
  - `name`: `VARCHAR(60)` (Not Null, Unique)
  - `description`: `TEXT`
  - `created_at`: `TIMESTAMPTZ` (Not Null, default `now()`)
  - `created_by`: `VARCHAR(255)`
  - `updated_by`: `VARCHAR(255)`
  - `updated_at`: `TIMESTAMPTZ` (Not Null, default `now()`)
- **Indexes**:
  - `idx_roles_name` ON `(name)`

### 4. `lookup_tables`
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

### 5. `org_field_options`
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
