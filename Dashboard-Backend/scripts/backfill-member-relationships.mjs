#!/usr/bin/env node
/**
 * One-time backfill: Firestore member_relationships -> PostgreSQL.
 *
 * Mirrors migrate-member-pay-onboarding-to-postgres.mjs's conventions: same
 * id/date coercion helpers, --dry-run flag, upsert-by-conflict-target
 * idempotency so it's safe to re-run while verifying. Firestore is left
 * untouched (rollback source) - this only writes to Postgres.
 *
 * The Postgres table has a real UNIQUE(parent_member_id, child_member_id)
 * constraint the old Firestore collection never had, so this uses
 * ON CONFLICT DO NOTHING: real historical data (first write) wins over any
 * accidental duplicate Firestore doc for the same edge.
 *
 * Usage:
 *   node scripts/backfill-member-relationships.mjs
 *   node scripts/backfill-member-relationships.mjs --dry-run
 */
import crypto, { createHash } from "node:crypto";
import { getDb } from "../src/config/firebase.js";
import { query, isPostgresConfigured } from "../src/lib/postgres/client.js";

const dryRun = process.argv.includes("--dry-run");

function uuidOrNull(value) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(trimmed)) return null;
  return trimmed;
}

/** Same deterministic-hash fallback as migrate-tasks-to-postgres.mjs, for
 * any legacy doc id that isn't already a UUID v4. */
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
  return uuidOrNull(value) ?? null;
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

async function migrateMemberRelationships(db) {
  const snap = await db.collection("member_relationships").get();

  let migrated = 0;
  let skippedBadIds = 0;

  for (const doc of snap.docs) {
    const d = doc.data() ?? {};
    const parentMemberId = uuidOrNull(d.parent_member_id);
    const childMemberId = uuidOrNull(d.child_member_id);
    if (!parentMemberId || !childMemberId) {
      skippedBadIds += 1;
      console.warn(`[member_relationships] skipping ${doc.id}: parent_member_id/child_member_id not a resolvable UUID`);
      continue;
    }

    const id = pgId(d.id ?? doc.id, "member_relationships");
    const projects = Array.isArray(d.projects) ? d.projects.filter((p) => typeof p === "string") : [];

    const inserted = await runQuery(
      `INSERT INTO member_relationships (id, parent_member_id, child_member_id, relationship_type, projects, created_at, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7)
       ON CONFLICT (parent_member_id, child_member_id) DO NOTHING
       RETURNING id`,
      [
        id,
        parentMemberId,
        childMemberId,
        typeof d.relationship_type === "string" ? d.relationship_type : "admin_create",
        JSON.stringify(projects),
        toDate(d.created_at),
        actorId(d.created_by),
      ],
    );
    if (dryRun || inserted.length) migrated += 1;
  }

  console.log(
    `${dryRun ? "[dry-run] " : ""}member_relationships: ${migrated} rows written (${skippedBadIds} skipped for unresolvable ids), ${snap.size} Firestore docs total`,
  );
  return { total: snap.size, migrated, skippedBadIds };
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

const counts = await migrateMemberRelationships(db);

console.log(
  dryRun
    ? "Dry run complete. Re-run without --dry-run to write to Postgres."
    : "Backfill complete. Verify row counts against Firestore, then confirm fn_can_actor_manage_target " +
        "returns correct answers for a known manager/subordinate pair before relying on it.",
);
console.log(counts);
