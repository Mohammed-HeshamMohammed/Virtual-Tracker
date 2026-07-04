import { FieldValue } from "firebase-admin/firestore";
import { getDb } from "../../config/firebase.js";
import { getSystemMetaDoc, setSystemMetaDoc } from "../../lib/postgres/member-data-store.js";

const MARKER_DOC = "client_budget_start_date_removed";

/**
 * Removes deprecated `start_date` / `startDate` from existing client budget documents.
 *
 * @returns {Promise<{ success: boolean; alreadyCompleted?: boolean; updated?: number; reason?: string }>}
 */
export async function removeClientBudgetStartDates() {
  const db = getDb();
  if (!db) {
    return { success: false, reason: "db_not_available" };
  }

  const marker = await getSystemMetaDoc(db, MARKER_DOC);
  if (marker?.completed === true) {
    return { success: true, alreadyCompleted: true, updated: 0 };
  }

  const budgetsSnap = await db.collection("client_budgets").get();
  let updated = 0;
  let batch = db.batch();
  let batchCount = 0;

  for (const doc of budgetsSnap.docs) {
    const data = doc.data() || {};
    const patch = /** @type {Record<string, unknown>} */ ({});
    if ("start_date" in data) patch.start_date = FieldValue.delete();
    if ("startDate" in data) patch.startDate = FieldValue.delete();
    if (Object.keys(patch).length === 0) continue;

    batch.set(doc.ref, patch, { merge: true });
    batchCount += 1;
    updated += 1;

    if (batchCount >= 400) {
      await batch.commit();
      batch = db.batch();
      batchCount = 0;
    }
  }

  if (batchCount > 0) {
    await batch.commit();
  }

  await setSystemMetaDoc(db, MARKER_DOC, {
    completed: true,
    updatedCount: updated,
    scannedCount: budgetsSnap.size,
    completedAt: new Date().toISOString(),
  });

  console.info(
    `[client-budget-start-date-migration] Scanned ${budgetsSnap.size} budgets; removed start date on ${updated}.`,
  );

  return { success: true, updated };
}
