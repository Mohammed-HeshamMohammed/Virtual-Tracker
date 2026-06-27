/**
 * Removes presence-related fields (including legacy nested presence object and modern flat fields)
 * from documents in the `members` collection in Firestore.
 *
 * Usage:
 *   npm run migrate:clean-presence
 *   npm run migrate:clean-presence -- --dry-run
 */

import { FieldValue } from "firebase-admin/firestore";
import { getDb } from "../src/config/firebase.js";

const BATCH_LIMIT = 400;

function hasDryRunFlag() {
  return process.argv.includes("--dry-run");
}

async function main() {
  const dryRun = hasDryRunFlag();
  const db = getDb();
  if (!db) {
    console.error(
      "Firebase Admin is not configured. Add firebase-admin.local.json or service account env vars in Backend/.env.",
    );
    process.exit(1);
  }

  const snap = await db.collection("members").get();
  let scanned = 0;
  let updated = 0;
  let batch = db.batch();
  let batchCount = 0;

  const fieldsToDelete = [
    "presence",
    "last_seen_at",
    "profile_linked_records_at",
    "status",
    "trackingStatus",
    "tracking_status",
    "last_activity_at",
    "lastActivityAt",
    "last_presence_at"
  ];

  for (const doc of snap.docs) {
    scanned += 1;
    const data = doc.data() || {};
    
    const updates = {};
    for (const field of fieldsToDelete) {
      if (Object.prototype.hasOwnProperty.call(data, field)) {
        updates[field] = FieldValue.delete();
      }
    }

    if (Object.keys(updates).length === 0) continue;

    updated += 1;
    if (dryRun) continue;

    batch.update(doc.ref, updates);
    batchCount += 1;
    if (batchCount >= BATCH_LIMIT) {
      await batch.commit();
      batch = db.batch();
      batchCount = 0;
    }
  }

  if (!dryRun && batchCount > 0) {
    await batch.commit();
  }

  console.info(
    JSON.stringify(
      {
        ok: true,
        dryRun,
        scanned,
        updated,
      },
      null,
      2,
    ),
  );
}

main().catch((err) => {
  console.error("[migrate:clean-presence]", err instanceof Error ? err.message : err);
  process.exit(1);
});
