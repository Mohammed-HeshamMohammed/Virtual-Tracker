# Virtual Tracker — PostgreSQL Schema

> Collections migrated from Firestore: `time_entries`, `timesheets`.
> All other collections remain in Firestore — see `FIRESTORE_SCHEMA.md`.

---

## Why these two collections

`time_entries` and `timesheets` require aggregate queries that Firestore cannot serve efficiently:
- Total billable hours per project per week (GROUP BY project_id, week)
- Payroll period summaries per member (SUM duration WHERE period = X)
- Approval dashboards filtering across all members by status and date range

In Firestore, all of the above require reading every document and aggregating in JS memory. In PostgreSQL, they are single indexed queries.

---

## Setup on Coolify

Add a PostgreSQL service to your Coolify instance alongside the existing services. Expose it only on the internal network — the Dashboard-Backend connects via the internal hostname, not a public port.

```
Service name:   vt-postgres
Internal host:  vt-postgres (Coolify internal DNS)
Port:           5432
Database:       virtual_tracker
```

Add to Dashboard-Backend environment:
```
POSTGRES_URL=postgresql://user:password@vt-postgres:5432/virtual_tracker
```

---

## Tables

### `time_entries`

```sql
CREATE TABLE time_entries (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  member_id    UUID        NOT NULL,
  project_id   UUID        NOT NULL,
  task_id      UUID,
  date         DATE        NOT NULL,
  start_time   TIME,
  end_time     TIME,
  duration     INTEGER     NOT NULL DEFAULT 0,  -- seconds
  description  TEXT,
  billable     BOOLEAN     NOT NULL DEFAULT false,
  status       VARCHAR(20) NOT NULL DEFAULT 'pending'
                           CHECK (status IN ('pending', 'approved', 'rejected')),
  created_by   VARCHAR(255), -- member uuid or Firebase Auth uid
  updated_by   VARCHAR(255),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

#### Indexes for `time_entries`

```sql
-- Primary access patterns
CREATE INDEX idx_te_member_date      ON time_entries (member_id, date DESC);
CREATE INDEX idx_te_project_date     ON time_entries (project_id, date DESC);
CREATE INDEX idx_te_member_project   ON time_entries (member_id, project_id);
CREATE INDEX idx_te_task             ON time_entries (task_id) WHERE task_id IS NOT NULL;
CREATE INDEX idx_te_status           ON time_entries (status);
CREATE INDEX idx_te_date_range       ON time_entries (date);
```

---

### `timesheets`

```sql
CREATE TABLE timesheets (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  member_id       UUID        NOT NULL,
  period_start    DATE        NOT NULL,
  period_end      DATE        NOT NULL,
  status          VARCHAR(20) NOT NULL DEFAULT 'draft'
                              CHECK (status IN ('draft', 'submitted', 'approved', 'rejected')),
  total_hours     NUMERIC(8,2),
  billable_hours  NUMERIC(8,2),
  submitted_at    TIMESTAMPTZ,
  approved_at     TIMESTAMPTZ,
  approved_by     VARCHAR(255), -- member uuid or Firebase Auth uid
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT uq_timesheet_member_period UNIQUE (member_id, period_start, period_end)
);
```

#### Indexes for `timesheets`

```sql
CREATE INDEX idx_ts_member          ON timesheets (member_id);
CREATE INDEX idx_ts_period          ON timesheets (period_start, period_end);
CREATE INDEX idx_ts_status          ON timesheets (status);
CREATE INDEX idx_ts_member_status   ON timesheets (member_id, status);
CREATE INDEX idx_ts_approved_by     ON timesheets (approved_by) WHERE approved_by IS NOT NULL;
```

---

## Auto-update trigger

Keeps `updated_at` current without requiring the application layer to set it.

```sql
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_time_entries_updated_at
  BEFORE UPDATE ON time_entries
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_timesheets_updated_at
  BEFORE UPDATE ON timesheets
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
```

---

## Common queries

### Time entries

```sql
-- Hours per project for a date range (billing report)
SELECT
  project_id,
  SUM(duration) / 3600.0               AS total_hours,
  SUM(CASE WHEN billable THEN duration ELSE 0 END) / 3600.0 AS billable_hours
FROM time_entries
WHERE date BETWEEN $1 AND $2   -- '2024-01-01', '2024-01-31'
  AND status = 'approved'
GROUP BY project_id
ORDER BY total_hours DESC;


-- Weekly hours for one member (dashboard widget)
SELECT
  DATE_TRUNC('week', date)::DATE        AS week_start,
  SUM(duration) / 3600.0               AS hours,
  SUM(CASE WHEN billable THEN duration ELSE 0 END) / 3600.0 AS billable_hours
FROM time_entries
WHERE member_id = $1
  AND date >= NOW() - INTERVAL '12 weeks'
GROUP BY week_start
ORDER BY week_start DESC;


-- All entries for a member in a period (timesheet detail)
SELECT *
FROM time_entries
WHERE member_id  = $1
  AND date BETWEEN $2 AND $3
ORDER BY date DESC, created_at DESC;


-- Pending entries waiting for approval
SELECT te.*, m.first_name, m.last_name
FROM time_entries te
WHERE te.status = 'pending'
  AND te.date BETWEEN $1 AND $2
ORDER BY te.date DESC;


-- Total hours per member for payroll period
SELECT
  member_id,
  SUM(duration) / 3600.0       AS total_hours,
  SUM(CASE WHEN billable THEN duration ELSE 0 END) / 3600.0 AS billable_hours,
  COUNT(*)                      AS entry_count
FROM time_entries
WHERE date BETWEEN $1 AND $2
  AND status = 'approved'
GROUP BY member_id;
```

### Timesheets

```sql
-- All submitted timesheets pending approval
SELECT *
FROM timesheets
WHERE status = 'submitted'
ORDER BY submitted_at ASC;


-- Timesheets for a member across periods
SELECT *
FROM timesheets
WHERE member_id = $1
ORDER BY period_start DESC;


-- Approval summary — how many per status in current period
SELECT status, COUNT(*) AS count
FROM timesheets
WHERE period_start = $1 AND period_end = $2
GROUP BY status;


-- Upsert timesheet (create or update if member re-submits)
INSERT INTO timesheets
  (member_id, period_start, period_end, status, total_hours, billable_hours, submitted_at)
VALUES
  ($1, $2, $3, 'submitted', $4, $5, now())
ON CONFLICT (member_id, period_start, period_end) DO UPDATE SET
  status         = EXCLUDED.status,
  total_hours    = EXCLUDED.total_hours,
  billable_hours = EXCLUDED.billable_hours,
  submitted_at   = EXCLUDED.submitted_at,
  updated_at     = now();
```

---

## Backend integration

### Connecting from Dashboard-Backend

```js
// src/lib/postgres/client.js
import pg from 'pg';

const pool = new pg.Pool({ connectionString: process.env.POSTGRES_URL });

export async function query(sql, params = []) {
  const client = await pool.connect();
  try {
    const result = await client.query(sql, params);
    return result.rows;
  } finally {
    client.release();
  }
}
```

### Replacing the schema CRUD for time-entries and timesheets

The generic schema CRUD routes (`GET/POST/PATCH/DELETE /api/time-entries`) that previously resolved to Firestore should now resolve to PostgreSQL queries. The response shape stays identical so the frontend requires no changes.

```js
// src/modules/schema/catalog/index.js
// For time-entries and timesheets, override the resolver to use pg query() 
// instead of db.collection(name) — all other entities stay Firestore.

// Example override pattern in schema/routes.js:
const POSTGRES_ENTITIES = new Set(['time-entries', 'timesheets']);

router.get('/api/:entity', async (req, res) => {
  if (POSTGRES_ENTITIES.has(req.params.entity)) {
    return handlePostgresGet(req, res);
  }
  return handleFirestoreGet(req, res);
});
```

### Timesheet auto-calculation

When a timesheet is submitted, compute `total_hours` and `billable_hours` from `time_entries` before writing:

```js
async function submitTimesheet(memberId, periodStart, periodEnd) {
  const [summary] = await query(`
    SELECT
      COALESCE(SUM(duration), 0) / 3600.0       AS total_hours,
      COALESCE(SUM(CASE WHEN billable THEN duration ELSE 0 END), 0) / 3600.0 AS billable_hours
    FROM time_entries
    WHERE member_id  = $1
      AND date BETWEEN $2 AND $3
      AND status    != 'rejected'
  `, [memberId, periodStart, periodEnd]);

  return query(`
    INSERT INTO timesheets (member_id, period_start, period_end, status, total_hours, billable_hours, submitted_at)
    VALUES ($1, $2, $3, 'submitted', $4, $5, now())
    ON CONFLICT (member_id, period_start, period_end) DO UPDATE SET
      status = 'submitted', total_hours = $4, billable_hours = $5,
      submitted_at = now(), updated_at = now()
    RETURNING *
  `, [memberId, periodStart, periodEnd, summary.total_hours, summary.billable_hours]);
}
```

---

## Migration from Firestore

Run once to move existing data. After migration, disable the Firestore collections for these entities.

```js
// tooling/migrate-to-postgres.mjs
import { db } from '../src/lib/firestore/client.js';
import { query } from '../src/lib/postgres/client.js';

async function migrateTimeEntries() {
  const snap = await db.collection('time_entries').get();
  for (const doc of snap.docs) {
    const d = doc.data();
    await query(`
      INSERT INTO time_entries
        (id, member_id, project_id, task_id, date, start_time, end_time,
         duration, description, billable, status, created_by, updated_by, created_at, updated_at)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
      ON CONFLICT (id) DO NOTHING
    `, [
      d.id, d.member_id, d.project_id, d.task_id ?? null,
      d.date, d.start_time ?? null, d.end_time ?? null,
      d.duration ?? 0, d.description ?? null,
      d.billable ?? false, d.status ?? 'pending',
      d.created_by ?? null, d.updated_by ?? null,
      d.created_at?.toDate() ?? new Date(),
      d.updated_at?.toDate() ?? new Date(),
    ]);
  }
  console.log(`Migrated ${snap.size} time_entries`);
}

async function migrateTimesheets() {
  const snap = await db.collection('timesheets').get();
  for (const doc of snap.docs) {
    const d = doc.data();
    await query(`
      INSERT INTO timesheets
        (id, member_id, period_start, period_end, status, total_hours, billable_hours,
         submitted_at, approved_at, approved_by, created_at, updated_at)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
      ON CONFLICT (id) DO NOTHING
    `, [
      d.id, d.member_id, d.period_start, d.period_end,
      d.status ?? 'draft',
      d.total_hours ?? null, d.billable_hours ?? null,
      d.submitted_at?.toDate() ?? null, d.approved_at?.toDate() ?? null,
      d.approved_by ?? null,
      d.created_at?.toDate() ?? new Date(),
      d.updated_at?.toDate() ?? new Date(),
    ]);
  }
  console.log(`Migrated ${snap.size} timesheets`);
}

await migrateTimeEntries();
await migrateTimesheets();
```
