#!/usr/bin/env node
/**
 * Cold-archive old activity_screenshots rows out of Postgres.
 *
 * Keeps the last RETENTION_DAYS of screenshots hot in Postgres (bytea). Anything
 * older gets bundled per member into one ZIP (one entry per screenshot, metadata
 * encoded in the entry filename), uploaded to GCS, and the source rows are
 * deleted - so Postgres storage stays bounded instead of growing forever.
 *
 * Self-guards via system_meta so it's safe to schedule this on any outer cron
 * cadence (e.g. daily) - it only does real work once every ARCHIVE_INTERVAL_DAYS.
 */
import archiver from "archiver";
import { query, isPostgresConfigured } from "../src/lib/postgres/client.js";
import { uploadToGCS } from "../src/lib/gcs/upload.js";

const RETENTION_DAYS = 7;
const ARCHIVE_INTERVAL_DAYS = 21;
const META_KEY = "screenshot_archive";

async function shouldRun() {
  const rows = await query(`SELECT updated_at FROM system_meta WHERE doc_key = $1`, [META_KEY]);
  const last = rows[0]?.updated_at;
  if (!last) return true;
  const daysSince = (Date.now() - new Date(last).getTime()) / 86_400_000;
  return daysSince >= ARCHIVE_INTERVAL_DAYS;
}

async function markRun(summary) {
  await query(
    `INSERT INTO system_meta (doc_key, payload, updated_at)
     VALUES ($1, $2, now())
     ON CONFLICT (doc_key) DO UPDATE SET payload = $2, updated_at = now()`,
    [META_KEY, JSON.stringify(summary)],
  );
}

/** @param {Array<{id: string, task_id: string|null, activity_level: number, captured_at: Date, image_data: Buffer}>} rows */
function zipMemberScreenshots(rows) {
  return new Promise((resolve, reject) => {
    const archive = archiver("zip", { zlib: { level: 9 } });
    const chunks = [];
    archive.on("data", (chunk) => chunks.push(chunk));
    archive.on("end", () => resolve(Buffer.concat(chunks)));
    archive.on("error", reject);
    for (const row of rows) {
      const capturedIso = new Date(row.captured_at).toISOString().replace(/[:.]/g, "-");
      const name = `${capturedIso}__task-${row.task_id || "none"}__act${row.activity_level}__${row.id}.webp`;
      archive.append(row.image_data, { name });
    }
    archive.finalize();
  });
}

async function run() {
  if (!isPostgresConfigured()) {
    console.error("POSTGRES_URL is not configured");
    process.exit(1);
  }
  if (!(await shouldRun())) {
    console.log(`Skipping - last archive run was under ${ARCHIVE_INTERVAL_DAYS} days ago.`);
    return;
  }

  const cutoff = new Date(Date.now() - RETENTION_DAYS * 86_400_000);
  const memberRows = await query(
    `SELECT DISTINCT member_id FROM activity_screenshots WHERE captured_at < $1 AND image_data IS NOT NULL`,
    [cutoff],
  );

  let membersArchived = 0;
  let screenshotsArchived = 0;

  for (const { member_id: memberId } of memberRows) {
    const rows = await query(
      `SELECT id, task_id, activity_level, captured_at, image_data
       FROM activity_screenshots
       WHERE member_id = $1 AND captured_at < $2 AND image_data IS NOT NULL
       ORDER BY captured_at ASC`,
      [memberId, cutoff],
    );
    if (rows.length === 0) continue;

    const zipBuffer = await zipMemberScreenshots(rows);
    const objectPath = `activity-screenshots-archive/${memberId}/${cutoff.toISOString().slice(0, 10)}.zip`;
    await uploadToGCS(zipBuffer, objectPath, "application/zip", false);

    const ids = rows.map((r) => r.id);
    await query(`DELETE FROM activity_screenshots WHERE id = ANY($1::uuid[])`, [ids]);

    membersArchived++;
    screenshotsArchived += rows.length;
    console.log(`Archived ${rows.length} screenshots for member ${memberId} -> ${objectPath}`);
  }

  await markRun({ ranAt: new Date().toISOString(), membersArchived, screenshotsArchived });
  console.log(`Archive complete. Members: ${membersArchived}, screenshots: ${screenshotsArchived}.`);
}

await run();
