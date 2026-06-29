#!/usr/bin/env node
/**
 * One-time migration: Firestore time_entries + timesheets → PostgreSQL.
 */
import { getDb } from "../src/config/firebase.js";
import { query, isPostgresConfigured } from "../src/lib/postgres/client.js";

async function migrateTimeEntries(db) {
  const snap = await db.collection("time_entries").get();
  let count = 0;
  for (const doc of snap.docs) {
    const d = doc.data();
    await query(
      `INSERT INTO time_entries
        (id, member_id, project_id, task_id, date, start_time, end_time,
         duration, description, billable, status, created_by, updated_by, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
       ON CONFLICT (id) DO NOTHING`,
      [
        d.id ?? doc.id,
        d.member_id,
        d.project_id,
        d.task_id ?? null,
        d.date,
        d.start_time ?? null,
        d.end_time ?? null,
        d.duration ?? 0,
        d.description ?? null,
        d.billable ?? false,
        d.status ?? "pending",
        d.created_by ?? null,
        d.updated_by ?? null,
        d.created_at?.toDate?.() ?? new Date(),
        d.updated_at?.toDate?.() ?? new Date(),
      ],
    );
    count++;
  }
  console.log(`Migrated ${count} time_entries`);
}

async function migrateTimesheets(db) {
  const snap = await db.collection("timesheets").get();
  let count = 0;
  for (const doc of snap.docs) {
    const d = doc.data();
    await query(
      `INSERT INTO timesheets
        (id, member_id, period_start, period_end, status, total_hours, billable_hours,
         submitted_at, approved_at, approved_by, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
       ON CONFLICT (id) DO NOTHING`,
      [
        d.id ?? doc.id,
        d.member_id,
        d.period_start,
        d.period_end,
        d.status ?? "draft",
        d.total_hours ?? null,
        d.billable_hours ?? null,
        d.submitted_at?.toDate?.() ?? null,
        d.approved_at?.toDate?.() ?? null,
        d.approved_by ?? null,
        d.created_at?.toDate?.() ?? new Date(),
        d.updated_at?.toDate?.() ?? new Date(),
      ],
    );
    count++;
  }
  console.log(`Migrated ${count} timesheets`);
}

const db = getDb();
if (!db) {
  console.error("Firestore not configured");
  process.exit(1);
}
if (!isPostgresConfigured()) {
  console.error("POSTGRES_URL is not configured");
  process.exit(1);
}

await migrateTimeEntries(db);
await migrateTimesheets(db);
console.log("Migration complete");
