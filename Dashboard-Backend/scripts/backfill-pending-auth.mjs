#!/usr/bin/env node
/**
 * One-time backfill: Firestore pending_auth_members + pending_auth_projects
 * -> PostgreSQL.
 *
 * Mirrors migrate-member-pay-onboarding-to-postgres.mjs's conventions:
 * --dry-run flag, upsert-by-conflict-target idempotency. Firestore is left
 * untouched (rollback source) - this only writes to Postgres.
 *
 * Field-name note: Firestore's pending_auth_projects docs use `pending_uid`;
 * the Postgres table names the same column `firebase_uid` (FK to
 * pending_auth_members.firebase_uid). Mapped explicitly below, not assumed
 * to match.
 *
 * A Firestore pending_auth_members doc whose firebase_uid already has a real
 * `members` row in Postgres is a stale leftover from before
 * promotePendingMemberCore cleaned it up (or cleanup failed) - not a real
 * pending account - and is skipped rather than backfilled.
 *
 * Usage:
 *   node scripts/backfill-pending-auth.mjs
 *   node scripts/backfill-pending-auth.mjs --dry-run
 */
import crypto from "node:crypto";
import { getDb } from "../src/config/firebase.js";
import { query, isPostgresConfigured } from "../src/lib/postgres/client.js";
import { getMemberByFirebaseUidPg } from "../src/lib/postgres/members-postgres.service.js";

const dryRun = process.argv.includes("--dry-run");

function uuidOrNull(value) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(trimmed)) return null;
  return trimmed;
}

function str(value, fallback = "") {
  return typeof value === "string" ? value : fallback;
}

function num(value, fallback = 0) {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function toDate(value) {
  if (!value) return new Date();
  if (typeof value?.toDate === "function") return value.toDate();
  if (value instanceof Date) return value;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? new Date() : parsed;
}

async function runQuery(sql, params) {
  if (dryRun) return [];
  return query(sql, params);
}

async function migratePendingAuthMembers(db) {
  const snap = await db.collection("pending_auth_members").get();

  let migrated = 0;
  let skippedConsumed = 0;
  const migratedUids = new Set();

  for (const doc of snap.docs) {
    const d = doc.data() ?? {};
    const firebaseUid = doc.id;

    const alreadyConsumed = await getMemberByFirebaseUidPg(firebaseUid);
    if (alreadyConsumed) {
      skippedConsumed += 1;
      console.warn(`[pending_auth_members] skipping ${firebaseUid}: already promoted to a real member`);
      continue;
    }

    await runQuery(
      `INSERT INTO pending_auth_members (firebase_uid, email, display_name, phone_number, role_id, role_name, pay_rate, created_by_uid, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       ON CONFLICT (firebase_uid) DO NOTHING`,
      [
        firebaseUid,
        str(d.email),
        str(d.display_name),
        str(d.phone_number),
        uuidOrNull(d.role_id),
        str(d.role_name),
        num(d.pay_rate),
        str(d.created_by_uid),
        toDate(d.created_at),
      ],
    );
    migratedUids.add(firebaseUid);
    migrated += 1;
  }

  console.log(
    `${dryRun ? "[dry-run] " : ""}pending_auth_members: ${migrated} rows written (${skippedConsumed} skipped, already consumed), ${snap.size} Firestore docs total`,
  );
  return { total: snap.size, migrated, skippedConsumed, migratedUids };
}

async function migratePendingAuthProjects(db, migratedUids) {
  const snap = await db.collection("pending_auth_projects").get();

  let migrated = 0;
  let skippedNoParent = 0;

  for (const doc of snap.docs) {
    const d = doc.data() ?? {};
    const firebaseUid = str(d.pending_uid);
    const projectId = uuidOrNull(d.project_id);
    if (!firebaseUid || !migratedUids.has(firebaseUid) || !projectId) {
      skippedNoParent += 1;
      continue;
    }

    await runQuery(
      `INSERT INTO pending_auth_projects (id, firebase_uid, project_id, created_by)
       VALUES ($1,$2,$3,$4)
       ON CONFLICT DO NOTHING`,
      [uuidOrNull(d.id) ?? crypto.randomUUID(), firebaseUid, projectId, uuidOrNull(d.created_by)],
    );
    migrated += 1;
  }

  console.log(
    `${dryRun ? "[dry-run] " : ""}pending_auth_projects: ${migrated} rows written (${skippedNoParent} skipped, no matching pending member), ${snap.size} Firestore docs total`,
  );
  return { total: snap.size, migrated, skippedNoParent };
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

const membersResult = await migratePendingAuthMembers(db);
const projectsResult = await migratePendingAuthProjects(db, membersResult.migratedUids);

console.log(
  dryRun
    ? "Dry run complete. Re-run without --dry-run to write to Postgres."
    : "Backfill complete. Verify row counts against Firestore before cutting over the preprovision read/write paths.",
);
console.log({ pending_auth_members: membersResult, pending_auth_projects: projectsResult });
