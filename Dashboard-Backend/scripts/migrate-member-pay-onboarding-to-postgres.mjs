#!/usr/bin/env node
/**
 * One-time migration: Firestore pay_rates + member_onboarding -> PostgreSQL.
 *
 * Mirrors migrate-tasks-to-postgres.mjs's conventions exactly: same id
 * resolution helpers, --dry-run flag, upsert-by-id idempotency so it's safe
 * to re-run while verifying. Scans live Firestore documents (not just the
 * schema catalog), since Firestore is schemaless and a doc can carry fields
 * the catalog never declared.
 *
 * Both tables' member_id/invite_id columns are plain UUID columns with no
 * FK constraint (unlike migrate-tasks-to-postgres.mjs's --add-fk step) -
 * `members` and `invites` are still Firestore-only, so there is nothing in
 * Postgres to reference. Firestore is left untouched; this only writes to
 * Postgres.
 *
 * pay_rates.member_id is UNIQUE in Postgres. If Firestore ever accumulated
 * more than one pay_rates doc for the same member_id (the app-level dedupe
 * this replaces existed for exactly that reason), only the most recently
 * updated doc is kept - same "pick latest by updated_at" rule
 * member-data-postgres.service.js's pickLatestMemberRow already uses
 * elsewhere for this exact ambiguity.
 *
 * Usage:
 *   node scripts/migrate-member-pay-onboarding-to-postgres.mjs
 *   node scripts/migrate-member-pay-onboarding-to-postgres.mjs --dry-run
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
  return uuidOrNull(value) ?? (typeof value === "string" && value.trim() ? value.trim().slice(0, 255) : null);
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

function toDateOnlyOrNull(value) {
  const d = toDateOrNull(value);
  return d ? d.toISOString().slice(0, 10) : null;
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

/** @param {import("firebase-admin/firestore").QueryDocumentSnapshot[]} docs */
function pickLatestByUpdatedAt(docs) {
  if (docs.length <= 1) return docs[0] ?? null;
  const toMs = (doc) => {
    const v = doc.data()?.updated_at ?? doc.data()?.updatedAt;
    return toDateOrNull(v)?.getTime() ?? 0;
  };
  return [...docs].sort((a, b) => toMs(b) - toMs(a))[0];
}

async function migratePayRates(db) {
  const snap = await db.collection("pay_rates").get();

  const byMemberId = new Map();
  let skippedNoMember = 0;
  for (const doc of snap.docs) {
    const d = doc.data() ?? {};
    const memberId = uuidOrNull(str(d, "member_id", "memberId"));
    if (!memberId) {
      skippedNoMember += 1;
      console.warn(`[pay_rates] skipping ${doc.id}: no resolvable member_id`);
      continue;
    }
    if (!byMemberId.has(memberId)) byMemberId.set(memberId, []);
    byMemberId.get(memberId).push(doc);
  }

  let duplicatesDropped = 0;
  let migrated = 0;
  for (const [memberId, docs] of byMemberId) {
    const keep = pickLatestByUpdatedAt(docs);
    duplicatesDropped += docs.length - 1;
    if (docs.length > 1) {
      console.warn(`[pay_rates] member ${memberId} had ${docs.length} docs - keeping ${keep.id}, dropping the rest`);
    }
    const d = keep.data() ?? {};
    const id = pgId(d.id ?? keep.id, "pay_rates");
    // member_id is the real business key (UNIQUE constraint) - a row may
    // already exist for it (e.g. created by ensureMemberScopedEntities
    // bootstrap) under a different id, so conflicts must resolve on
    // member_id, not id. Postgres only allows one ON CONFLICT target.
    await runQuery(
      `INSERT INTO pay_rates (
         id, member_id, type, rate, currency, pay_period, require_timesheet_approval,
         effective_date, status, note, created_by, updated_by, created_at, updated_at
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
       ON CONFLICT (member_id) DO UPDATE SET
         type = EXCLUDED.type, rate = EXCLUDED.rate, currency = EXCLUDED.currency,
         pay_period = EXCLUDED.pay_period, require_timesheet_approval = EXCLUDED.require_timesheet_approval,
         effective_date = EXCLUDED.effective_date, status = EXCLUDED.status, note = EXCLUDED.note,
         updated_by = EXCLUDED.updated_by, updated_at = EXCLUDED.updated_at`,
      [
        id,
        memberId,
        str(d, "type") ?? "hourly",
        num(d, "rate") ?? 0,
        str(d, "currency") ?? "USD",
        str(d, "pay_period", "payPeriod") ?? "None",
        bool(d, false, "require_timesheet_approval", "requireTimesheetApproval"),
        toDateOnlyOrNull(d.effective_date ?? d.effectiveDate),
        str(d, "status") ?? "active",
        str(d, "note") ?? "",
        actorId(d.created_by ?? d.createdBy),
        actorId(d.updated_by ?? d.updatedBy),
        toDate(d.created_at ?? d.createdAt),
        toDate(d.updated_at ?? d.updatedAt),
      ],
    );
    migrated += 1;
  }

  console.log(
    `${dryRun ? "[dry-run] " : ""}pay_rates: ${migrated} rows (${skippedNoMember} skipped for no member_id, ${duplicatesDropped} duplicate docs dropped)`,
  );
  return { total: snap.size, migrated, skippedNoMember, duplicatesDropped };
}

async function migrateMemberOnboarding(db) {
  const snap = await db.collection("member_onboarding").get();
  let migrated = 0;
  for (const doc of snap.docs) {
    const d = doc.data() ?? {};
    const id = pgId(d.id ?? doc.id, "member_onboarding");
    const memberId = uuidOrNull(str(d, "member_id", "memberId"));
    const inviteId = uuidOrNull(str(d, "invite_id", "inviteId"));
    await runQuery(
      `INSERT INTO member_onboarding (
         id, member_id, invite_id, created_account, created_account_at,
         downloaded_app, downloaded_app_at, tracked_time, tracked_time_at,
         last_reminder_sent_at, last_reminder_sent_by, created_at, created_by, updated_by, updated_at
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
       ON CONFLICT (id) DO UPDATE SET
         member_id = EXCLUDED.member_id, invite_id = EXCLUDED.invite_id,
         created_account = EXCLUDED.created_account, created_account_at = EXCLUDED.created_account_at,
         downloaded_app = EXCLUDED.downloaded_app, downloaded_app_at = EXCLUDED.downloaded_app_at,
         tracked_time = EXCLUDED.tracked_time, tracked_time_at = EXCLUDED.tracked_time_at,
         last_reminder_sent_at = EXCLUDED.last_reminder_sent_at, last_reminder_sent_by = EXCLUDED.last_reminder_sent_by,
         created_by = EXCLUDED.created_by, updated_by = EXCLUDED.updated_by, updated_at = EXCLUDED.updated_at`,
      [
        id,
        memberId,
        inviteId,
        bool(d, false, "created_account", "createdAccount"),
        toDateOrNull(d.created_account_at ?? d.createdAccountAt),
        bool(d, false, "downloaded_app", "downloadedApp"),
        toDateOrNull(d.downloaded_app_at ?? d.downloadedAppAt),
        bool(d, false, "tracked_time", "trackedTime"),
        toDateOrNull(d.tracked_time_at ?? d.trackedTimeAt),
        toDateOrNull(d.last_reminder_sent_at ?? d.lastReminderSentAt),
        str(d, "last_reminder_sent_by", "lastReminderSentBy") ?? "",
        toDate(d.created_at ?? d.createdAt),
        actorId(d.created_by ?? d.createdBy),
        actorId(d.updated_by ?? d.updatedBy),
        toDate(d.updated_at ?? d.updatedAt),
      ],
    );
    migrated += 1;
  }
  console.log(`${dryRun ? "[dry-run] " : ""}member_onboarding: ${migrated} rows`);
  return { total: snap.size, migrated };
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

const counts = {
  pay_rates: await migratePayRates(db),
  member_onboarding: await migrateMemberOnboarding(db),
};

console.log(
  dryRun
    ? "Dry run complete. Re-run without --dry-run to write to Postgres."
    : "Backfill complete. Verify row counts against Firestore before relying on the Postgres-backed " +
        "reads/writes this migration enables (already live in code - see member-data-store.js's " +
        "PG_MEMBER_SCOPED and member-onboarding/routes.js).",
);
console.log(counts);
