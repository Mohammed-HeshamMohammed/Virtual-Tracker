#!/usr/bin/env node
/**
 * Activity data retention (implementation.md Phase 4.7).
 *
 * activity_screenshots stores image_data as inline Postgres BYTEA on every
 * insert (activity-events-postgres.service.js's insertActivityScreenshot) -
 * the routes.js capture path's own comment already says "the archive job
 * moves rows out to GCS once they age out", but that job was never written.
 * This is it: run manually or wire into a periodic job (Coolify's own
 * scheduled-task feature, not an in-process scheduler this backend doesn't
 * have) - not auto-run on every boot like ensure-lookup-schema.js.
 *
 * Two independent steps:
 *   1. Archive: screenshots older than --archive-days (default 7) that still
 *      have image_data get uploaded to GCS, then image_data is cleared and
 *      screenshot_url is set to the GCS object path - reclaims Postgres/disk
 *      space without losing the screenshot itself.
 *   2. Retention: activity_app_logs/activity_url_logs rows older than
 *      --retention-days (default 90), and fully-archived screenshot rows
 *      (image_data already NULL) older than --retention-days, are deleted
 *      outright. These day counts are illustrative, not a compliance
 *      recommendation - override via flags if your retention policy differs.
 *
 * Usage:
 *   npm run archive:screenshots -- --dry-run
 *   npm run archive:screenshots
 *   npm run archive:screenshots -- --archive-days=7 --retention-days=90
 */
import { query, isPostgresConfigured } from "../src/lib/postgres/client.js";
import { uploadToGCS } from "../src/lib/gcs/upload.js";

const dryRun = process.argv.includes("--dry-run");

function flagValue(name, fallback) {
  const arg = process.argv.find((a) => a.startsWith(`--${name}=`));
  if (!arg) return fallback;
  const value = Number(arg.split("=")[1]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

const archiveDays = flagValue("archive-days", 7);
const retentionDays = flagValue("retention-days", 90);

async function archiveOldScreenshots() {
  const rows = await query(
    `SELECT id, member_id, image_data, captured_at
     FROM activity_screenshots
     WHERE image_data IS NOT NULL AND captured_at < now() - ($1 || ' days')::interval
     ORDER BY captured_at ASC
     LIMIT 500`,
    [archiveDays],
  );

  let archived = 0;
  let failed = 0;
  for (const row of rows) {
    const objectPath = `activity-screenshots/${row.member_id}/${row.id}.webp`;
    if (dryRun) {
      console.log(`[dry-run] would archive ${row.id} -> ${objectPath}`);
      archived++;
      continue;
    }
    try {
      await uploadToGCS(row.image_data, objectPath, "image/webp", false);
      await query(
        `UPDATE activity_screenshots SET screenshot_url = $2, image_data = NULL WHERE id = $1`,
        [row.id, objectPath],
      );
      archived++;
    } catch (err) {
      // Leave image_data in place on failure - a screenshot that fails to
      // archive stays fully intact in Postgres rather than being half-lost.
      failed++;
      console.warn(`[activity-retention] archive failed for ${row.id}:`, err instanceof Error ? err.message : err);
    }
  }
  return { scanned: rows.length, archived, failed };
}

async function deleteExpiredRows() {
  const targets = [
    { table: "activity_app_logs", column: "started_at" },
    { table: "activity_url_logs", column: "visited_at" },
    // Only fully-archived screenshot rows (image_data already cleared) - a
    // row still holding image_data was never archived and stays regardless
    // of age, since deleting it would be actual data loss, not cleanup.
    { table: "activity_screenshots", column: "captured_at", extraWhere: "image_data IS NULL" },
  ];

  const results = [];
  for (const { table, column, extraWhere } of targets) {
    const where = [`${column} < now() - ($1 || ' days')::interval`, extraWhere].filter(Boolean).join(" AND ");
    if (dryRun) {
      const [{ count }] = await query(`SELECT COUNT(*)::int AS count FROM ${table} WHERE ${where}`, [retentionDays]);
      results.push({ table, wouldDelete: count });
      continue;
    }
    const deleted = await query(`DELETE FROM ${table} WHERE ${where} RETURNING id`, [retentionDays]);
    results.push({ table, deleted: deleted.length });
  }
  return results;
}

async function main() {
  isPostgresConfigured();
  console.log(`activity-retention: archive-days=${archiveDays} retention-days=${retentionDays} dry-run=${dryRun}`);

  const archiveResult = await archiveOldScreenshots();
  console.log("Archive:", archiveResult);

  const retentionResult = await deleteExpiredRows();
  console.log("Retention:", retentionResult);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("activity-retention failed:", err);
    process.exit(1);
  });
