#!/usr/bin/env node
/**
 * One-time migration: Firestore lookup reference data → PostgreSQL.
 * Leaves Firestore collections untouched for rollback until cutover is verified.
 *
 * Usage:
 *   node --env-file-if-exists=.env scripts/migrate-lookups-to-postgres.mjs
 *   node --env-file-if-exists=.env scripts/migrate-lookups-to-postgres.mjs --dry-run
 */
import { getDb } from "../src/config/firebase.js";
import { query, isPostgresConfigured } from "../src/lib/postgres/client.js";

const LOOKUP_CATEGORY_MAP = {
  job_titles: "job_title",
  departments: "department",
  job_types: "job_type",
  tax_types: "tax_type",
};

const ORG_FIELD_TYPES = new Set([
  "jobTitle",
  "department",
  "jobType",
  "employmentType",
  "employedThrough",
  "workplaceModel",
  "taxType",
  "terminationReason",
]);

const dryRun = process.argv.includes("--dry-run");

/** Firestore often stores "" for unset UUID FKs; Postgres uuid columns need null. */
function uuidOrNull(value) {
  if (value === null || value === undefined) return null;
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * @param {string} sql
 * @param {unknown[]} params
 */
async function runQuery(sql, params) {
  if (dryRun) return [];
  return query(sql, params);
}

async function migrateRoles(db) {
  const snap = await db.collection("roles").get();
  for (const doc of snap.docs) {
    const d = doc.data();
    const id = d.id ?? doc.id;
    await runQuery(
      `INSERT INTO roles (id, name, description, created_at, created_by, updated_by)
       VALUES ($1,$2,$3,$4,$5,$6)
       ON CONFLICT (id) DO UPDATE SET
         name = EXCLUDED.name,
         description = EXCLUDED.description,
         updated_by = EXCLUDED.updated_by`,
      [
        id,
        d.name,
        d.description ?? null,
        d.created_at?.toDate?.() ?? new Date(),
        uuidOrNull(d.created_by),
        uuidOrNull(d.updated_by),
      ],
    );
  }
  console.log(`${dryRun ? "[dry-run] " : ""}Migrated ${snap.size} roles`);
}

/**
 * @param {import("firebase-admin/firestore").Firestore} db
 * @param {string} firestoreCollection
 * @param {string} category
 */
async function migrateLookupCollection(db, firestoreCollection, category) {
  const snap = await db.collection(firestoreCollection).get();
  for (const doc of snap.docs) {
    const d = doc.data();
    await runQuery(
      `INSERT INTO lookup_tables (id, category, name, list_ranking, created_at, created_by, updated_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7)
       ON CONFLICT (id) DO UPDATE SET
         category = EXCLUDED.category,
         name = EXCLUDED.name,
         list_ranking = EXCLUDED.list_ranking,
         updated_by = EXCLUDED.updated_by`,
      [
        d.id ?? doc.id,
        category,
        d.name,
        d.list_ranking ?? null,
        d.created_at?.toDate?.() ?? new Date(),
        uuidOrNull(d.created_by),
        uuidOrNull(d.updated_by),
      ],
    );
  }
  console.log(
    `${dryRun ? "[dry-run] " : ""}Migrated ${snap.size} rows from ${firestoreCollection} → ${category}`,
  );
}

/**
 * @param {import("firebase-admin/firestore").Firestore} db
 */
async function migrateOrgFieldOptions(db) {
  const snap = await db.collection("members_field_data").get();
  let migrated = 0;
  for (const doc of snap.docs) {
    const d = doc.data();
    if (!ORG_FIELD_TYPES.has(d.type)) continue;

    await runQuery(
      `INSERT INTO org_field_options (id, type, label, position, created_at, updated_at, modified_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7)
       ON CONFLICT (id) DO UPDATE SET
         type = EXCLUDED.type,
         label = EXCLUDED.label,
         position = EXCLUDED.position,
         updated_at = EXCLUDED.updated_at,
         modified_by = EXCLUDED.modified_by`,
      [
        d.id ?? doc.id,
        d.type,
        d.label,
        d.position ?? 0,
        d.created_at?.toDate?.() ?? new Date(),
        d.updated_at?.toDate?.() ?? new Date(),
        d.modifiedBy ?? null,
      ],
    );
    migrated++;
  }
  console.log(
    `${dryRun ? "[dry-run] " : ""}Migrated ${migrated} org field options (skipped memberFormSnapshot rows)`,
  );
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

if (!dryRun) {
  console.log("Clearing Postgres lookup tables (Firestore is source of truth)...");
  await runQuery(`DELETE FROM org_field_options`, []);
  await runQuery(`DELETE FROM lookup_tables`, []);
  await runQuery(`DELETE FROM roles`, []);
}

await migrateRoles(db);
for (const [collection, category] of Object.entries(LOOKUP_CATEGORY_MAP)) {
  await migrateLookupCollection(db, collection, category);
}
await migrateOrgFieldOptions(db);

console.log(
  dryRun
    ? "Dry run complete. Re-run without --dry-run to write to Postgres."
    : "Lookup migration complete. Verify Postgres data before disabling Firestore reads.",
);
