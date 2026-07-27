#!/usr/bin/env node
/**
 * One-time migration: Firestore projects domain -> PostgreSQL.
 * See PROPOSAL-Projects-Migration-to-PostgreSQL.md, Phase 1.
 *
 * Scans LIVE documents (not the schema catalog) so undeclared fields like
 * project_budgets._seedBudgetSpentPct aren't silently dropped - the catalog
 * is a starting point, not a guarantee of completeness (Firestore is
 * schemaless; service code can and does write fields the catalog never
 * declared). Leaves every Firestore collection untouched - this only writes
 * to Postgres, so it's safe to run repeatedly (upserts by id) while
 * verifying, right up until the actual cutover.
 *
 * Usage:
 *   node scripts/migrate-projects-to-postgres.mjs
 *   node scripts/migrate-projects-to-postgres.mjs --dry-run
 *   node scripts/migrate-projects-to-postgres.mjs --add-fk   (after verifying the backfill - see below)
 */
import crypto, { createHash } from "node:crypto";
import { getDb } from "../src/config/firebase.js";
import { query, isPostgresConfigured } from "../src/lib/postgres/client.js";

const dryRun = process.argv.includes("--dry-run");
const addFk = process.argv.includes("--add-fk");

function uuidOrNull(value) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(trimmed)) return null;
  return trimmed;
}

/** Firestore doc ids for this domain are documented as UUID v4 already, but
 * fall back to a deterministic hash the same way migrate-lookups-to-postgres.mjs
 * does, in case any legacy row doesn't actually conform. */
function pgId(value, namespace) {
  const asUuid = uuidOrNull(value);
  if (asUuid) return asUuid;
  const raw = typeof value === "string" ? value.trim() : "";
  if (!raw) return crypto.randomUUID();
  const hash = createHash("sha256").update(`${namespace}:${raw}`).digest();
  const bytes = Buffer.from(hash.subarray(0, 16));
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

function actorId(value) {
  const uuid = uuidOrNull(value);
  return uuid ?? null;
}

function toDate(value) {
  if (!value) return new Date();
  if (typeof value?.toDate === "function") return value.toDate();
  if (value instanceof Date) return value;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? new Date() : parsed;
}

function toDateOrNull(value) {
  if (!value) return null;
  if (typeof value?.toDate === "function") return value.toDate();
  if (value instanceof Date) return value;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function str(row, ...keys) {
  for (const key of keys) {
    if (typeof row[key] === "string") return row[key];
  }
  return null;
}

function num(row, ...keys) {
  for (const key of keys) {
    if (typeof row[key] === "number" && Number.isFinite(row[key])) return row[key];
  }
  return null;
}

function bool(row, fallback, ...keys) {
  for (const key of keys) {
    if (typeof row[key] === "boolean") return row[key];
  }
  return fallback;
}

async function runQuery(sql, params) {
  if (dryRun) return [];
  return query(sql, params);
}

async function migrateProjects(db) {
  const snap = await db.collection("projects_VirtualTacker").get();
  for (const doc of snap.docs) {
    const d = doc.data() ?? {};
    const id = pgId(d.id ?? doc.id, "projects");
    await runQuery(
      `INSERT INTO projects (
         id, name, status, billable, disable_activity, allow_project_tracking, disable_idle_time,
         client_id, managers_notes, users_notes, viewers_notes, created_at, updated_at,
         created_by, updated_by, archived_by, archived_at
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
       ON CONFLICT (id) DO UPDATE SET
         name = EXCLUDED.name, status = EXCLUDED.status, billable = EXCLUDED.billable,
         disable_activity = EXCLUDED.disable_activity, allow_project_tracking = EXCLUDED.allow_project_tracking,
         disable_idle_time = EXCLUDED.disable_idle_time, client_id = EXCLUDED.client_id,
         managers_notes = EXCLUDED.managers_notes, users_notes = EXCLUDED.users_notes,
         viewers_notes = EXCLUDED.viewers_notes, updated_at = EXCLUDED.updated_at,
         updated_by = EXCLUDED.updated_by, archived_by = EXCLUDED.archived_by, archived_at = EXCLUDED.archived_at`,
      [
        id,
        str(d, "name") ?? "Untitled project",
        str(d, "status") ?? "active",
        bool(d, true, "billable"),
        bool(d, false, "disable_activity", "disableActivity"),
        bool(d, true, "allow_project_tracking", "allowProjectTracking"),
        bool(d, false, "disable_idle_time", "disableIdleTime"),
        uuidOrNull(str(d, "client_id", "clientId")),
        str(d, "managers_notes", "managersNotes"),
        str(d, "users_notes", "usersNotes"),
        str(d, "viewers_notes", "viewersNotes"),
        toDate(d.created_at ?? d.createdAt),
        toDate(d.updated_at ?? d.updatedAt),
        actorId(str(d, "created_by", "createdBy")),
        actorId(str(d, "updated_by", "updatedBy")),
        actorId(str(d, "archived_by", "archivedBy")),
        toDateOrNull(d.archived_at ?? d.archivedAt),
      ],
    );
  }
  console.log(`${dryRun ? "[dry-run] " : ""}projects: ${snap.size} rows`);
  return snap.size;
}

async function migrateProjectMembers(db) {
  const snap = await db.collection("project_members").get();
  for (const doc of snap.docs) {
    const d = doc.data() ?? {};
    const projectId = uuidOrNull(str(d, "project_id", "projectId"));
    const memberId = uuidOrNull(str(d, "member_id", "memberId"));
    if (!projectId || !memberId) continue;
    const id = pgId(d.id ?? doc.id, "project_members");
    await runQuery(
      `INSERT INTO project_members (id, project_id, member_id, project_role, assigned_at, assigned_by, updated_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7)
       ON CONFLICT (project_id, member_id) DO UPDATE SET
         project_role = EXCLUDED.project_role, updated_by = EXCLUDED.updated_by`,
      [
        id,
        projectId,
        memberId,
        str(d, "project_role", "projectRole"),
        toDate(d.assigned_at ?? d.assignedAt),
        actorId(str(d, "assigned_by", "assignedBy")),
        actorId(str(d, "updated_by", "updatedBy")),
      ],
    );
  }
  console.log(`${dryRun ? "[dry-run] " : ""}project_members: ${snap.size} rows`);
  return snap.size;
}

async function migrateProjectBudgets(db) {
  const snap = await db.collection("project_budgets").get();
  for (const doc of snap.docs) {
    const d = doc.data() ?? {};
    const projectId = uuidOrNull(str(d, "project_id", "projectId"));
    if (!projectId) continue;
    const id = pgId(d.id ?? doc.id, "project_budgets");
    await runQuery(
      `INSERT INTO project_budgets (
         id, project_id, type, based_on, cost, notify_project_members, notify_at_pct, who_to_notify,
         stop_timers_when_reached, stop_timers_at_pct, resets, start_date, include_non_billable_time,
         created_at, updated_at, created_by, updated_by
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
       ON CONFLICT (project_id) DO UPDATE SET
         type = EXCLUDED.type, based_on = EXCLUDED.based_on, cost = EXCLUDED.cost,
         notify_project_members = EXCLUDED.notify_project_members, notify_at_pct = EXCLUDED.notify_at_pct,
         who_to_notify = EXCLUDED.who_to_notify, stop_timers_when_reached = EXCLUDED.stop_timers_when_reached,
         stop_timers_at_pct = EXCLUDED.stop_timers_at_pct, resets = EXCLUDED.resets,
         start_date = EXCLUDED.start_date, include_non_billable_time = EXCLUDED.include_non_billable_time,
         updated_at = EXCLUDED.updated_at, updated_by = EXCLUDED.updated_by`,
      [
        id,
        projectId,
        str(d, "type") ?? "Cost based",
        str(d, "based_on", "basedOn"),
        num(d, "cost") ?? 0,
        bool(d, false, "notify_project_members", "notifyProjectMembers"),
        num(d, "notify_at_pct", "notifyAtPct"),
        str(d, "who_to_notify", "whoToNotify"),
        bool(d, false, "stop_timers_when_reached", "stopTimersWhenReached"),
        num(d, "stop_timers_at_pct", "stopTimersAtPct"),
        str(d, "resets") ?? "Never",
        toDateOrNull(d.start_date ?? d.startDate)?.toISOString().slice(0, 10) ?? null,
        bool(d, true, "include_non_billable_time", "includeNonBillableTime"),
        toDate(d.created_at ?? d.createdAt),
        toDate(d.updated_at ?? d.updatedAt),
        actorId(str(d, "created_by", "createdBy")),
        actorId(str(d, "updated_by", "updatedBy")),
      ],
    );
  }
  console.log(`${dryRun ? "[dry-run] " : ""}project_budgets: ${snap.size} rows`);
  return snap.size;
}

async function migrateProjectMemberLimits(db) {
  const snap = await db.collection("project_member_limits").get();
  for (const doc of snap.docs) {
    const d = doc.data() ?? {};
    const projectId = uuidOrNull(str(d, "project_id", "projectId"));
    const memberId = uuidOrNull(str(d, "member_id", "memberId"));
    if (!projectId || !memberId) continue;
    const id = pgId(d.id ?? doc.id, "project_member_limits");
    await runQuery(
      `INSERT INTO project_member_limits (
         id, project_id, member_id, type, based_on, cost, resets, start_date, notify_at_pct,
         notify_project_members, created_at, updated_at, created_by, updated_by
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
       ON CONFLICT (project_id, member_id) DO UPDATE SET
         type = EXCLUDED.type, based_on = EXCLUDED.based_on, cost = EXCLUDED.cost, resets = EXCLUDED.resets,
         start_date = EXCLUDED.start_date, notify_at_pct = EXCLUDED.notify_at_pct,
         notify_project_members = EXCLUDED.notify_project_members, updated_at = EXCLUDED.updated_at,
         updated_by = EXCLUDED.updated_by`,
      [
        id,
        projectId,
        memberId,
        str(d, "type"),
        str(d, "based_on", "basedOn"),
        num(d, "cost"),
        str(d, "resets") ?? "Never",
        toDateOrNull(d.start_date ?? d.startDate)?.toISOString().slice(0, 10) ?? null,
        num(d, "notify_at_pct", "notifyAtPct"),
        bool(d, true, "notify_project_members", "notifyProjectMembers"),
        toDate(d.created_at ?? d.createdAt),
        toDate(d.updated_at ?? d.updatedAt),
        actorId(str(d, "created_by", "createdBy")),
        actorId(str(d, "updated_by", "updatedBy")),
      ],
    );
  }
  console.log(`${dryRun ? "[dry-run] " : ""}project_member_limits: ${snap.size} rows`);
  return snap.size;
}

async function migrateClientProjects(db) {
  const snap = await db.collection("client_projects").get();
  for (const doc of snap.docs) {
    const d = doc.data() ?? {};
    const clientId = uuidOrNull(str(d, "client_id", "clientId"));
    const projectId = uuidOrNull(str(d, "project_id", "projectId"));
    if (!clientId || !projectId) continue;
    const id = pgId(d.id ?? doc.id, "client_projects");
    await runQuery(
      `INSERT INTO client_projects (id, client_id, project_id, assigned_at, assigned_by)
       VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (client_id, project_id) DO NOTHING`,
      [id, clientId, projectId, toDate(d.assigned_at ?? d.assignedAt), actorId(str(d, "assigned_by", "assignedBy"))],
    );
  }
  console.log(`${dryRun ? "[dry-run] " : ""}client_projects: ${snap.size} rows`);
  return snap.size;
}

async function migrateTeamProjects(db) {
  const snap = await db.collection("team_projects").get();
  for (const doc of snap.docs) {
    const d = doc.data() ?? {};
    const teamId = uuidOrNull(str(d, "team_id", "teamId"));
    const projectId = uuidOrNull(str(d, "project_id", "projectId"));
    if (!teamId || !projectId) continue;
    const id = pgId(d.id ?? doc.id, "team_projects");
    await runQuery(
      `INSERT INTO team_projects (id, team_id, project_id, assigned_at, assigned_by)
       VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (team_id, project_id) DO NOTHING`,
      [id, teamId, projectId, toDate(d.assigned_at ?? d.assignedAt), actorId(str(d, "assigned_by", "assignedBy"))],
    );
  }
  console.log(`${dryRun ? "[dry-run] " : ""}team_projects: ${snap.size} rows`);
  return snap.size;
}

/** Only run once the backfill above is verified clean - orphaned project_id
 * values in time_entries (from deleted/never-migrated projects) will make
 * this fail. That's the FK doing its job, not a bug in this script. */
async function addTimeEntriesFk() {
  const orphans = await query(
    `SELECT COUNT(*)::int AS n FROM time_entries te
     LEFT JOIN projects p ON p.id = te.project_id
     WHERE p.id IS NULL`,
  );
  const orphanCount = orphans[0]?.n ?? 0;
  if (orphanCount > 0) {
    console.error(
      `Refusing to add FK: ${orphanCount} time_entries rows reference a project_id with no matching row in projects. Fix those first.`,
    );
    process.exitCode = 1;
    return;
  }
  await query(`
    DO $$
    BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_te_project') THEN
        ALTER TABLE time_entries ADD CONSTRAINT fk_te_project FOREIGN KEY (project_id) REFERENCES projects(id);
      END IF;
    END $$;
  `);
  console.log("FK fk_te_project added (or already existed).");
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

if (addFk) {
  await addTimeEntriesFk();
  process.exit(0);
}

const counts = {
  projects: await migrateProjects(db),
  project_members: await migrateProjectMembers(db),
  project_budgets: await migrateProjectBudgets(db),
  project_member_limits: await migrateProjectMemberLimits(db),
  client_projects: await migrateClientProjects(db),
  team_projects: await migrateTeamProjects(db),
};

console.log(
  dryRun
    ? "Dry run complete. Re-run without --dry-run to write to Postgres."
    : "Backfill complete. Verify row counts against Firestore before repointing any read/write path, " +
        "then run with --add-fk once satisfied.",
);
console.log(counts);
