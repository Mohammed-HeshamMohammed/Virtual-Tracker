#!/usr/bin/env node
/**
 * PERMANENTLY deletes the legacy Firestore collections for the tasks domain
 * (implementation.md Phase 2/legacy cleanup) - `tasks`, `task_assignments`,
 * and every task's `tasks/{taskId}/time_tracking` subcollection. All three
 * have been fully superseded by Postgres (`tasks`, `task_assignments`,
 * `task_member_progress`) since Phase 2's cutover - nothing in the backend
 * reads these Firestore collections anymore (confirmed by the same audit
 * that did the legacy code-path cleanup).
 *
 * This does NOT touch `task_subtasks`, `task_comments`, `task_attachments`,
 * or `task_hours` - those 4 subcollections/collections are still genuinely
 * Firestore-resident and out of scope for this migration.
 *
 * Deliberately NOT run automatically by anything - this is a one-time,
 * human-invoked, irreversible action. Run it yourself when you're ready;
 * nothing in the app calls this script.
 *
 * Usage:
 *   node --use-system-ca --env-file-if-exists=.env scripts/delete-legacy-task-firestore-data.mjs --dry-run
 *   node --use-system-ca --env-file-if-exists=.env scripts/delete-legacy-task-firestore-data.mjs --confirm
 *
 * --dry-run reports counts only, deletes nothing.
 * --confirm is required to actually delete anything - running with neither
 * flag does nothing and just prints usage.
 */
import { getDb } from "../src/config/firebase.js";

const dryRun = process.argv.includes("--dry-run");
const confirmed = process.argv.includes("--confirm");

async function deleteAllDocsInBatches(collectionRef, label, { dryRun }) {
  let total = 0;
  for (;;) {
    const snap = await collectionRef.limit(400).get();
    if (snap.empty) break;
    total += snap.size;
    if (!dryRun) {
      const batch = collectionRef.firestore.batch();
      for (const doc of snap.docs) batch.delete(doc.ref);
      await batch.commit();
    } else {
      // Dry run still has to stop looping - without deleting, the same page
      // would be returned forever, so just count this one page and report
      // it as a lower bound rather than looping infinitely.
      console.log(`[dry-run] ${label}: found at least ${snap.size} docs (stopped after one page)`);
      return snap.size;
    }
  }
  console.log(`${label}: deleted ${total} docs`);
  return total;
}

async function main() {
  if (!dryRun && !confirmed) {
    console.log("Usage: node scripts/delete-legacy-task-firestore-data.mjs --dry-run | --confirm");
    console.log("Neither flag given - doing nothing.");
    return;
  }

  const db = getDb();

  // 1. Every task's time_tracking subcollection, before deleting the tasks
  //    themselves - Firestore doesn't cascade-delete subcollections when a
  //    parent doc is deleted, so these would otherwise become permanently
  //    orphaned (invisible, unreachable, but never cleaned up).
  const tasksSnap = await db.collection("tasks").get();
  console.log(`Found ${tasksSnap.size} task docs to process time_tracking subcollections for.`);
  let timeTrackingTotal = 0;
  for (const taskDoc of tasksSnap.docs) {
    const sub = taskDoc.ref.collection("time_tracking");
    timeTrackingTotal += await deleteAllDocsInBatches(sub, `tasks/${taskDoc.id}/time_tracking`, { dryRun });
  }
  console.log(`time_tracking subcollections total: ${timeTrackingTotal}`);

  // 2. task_assignments (flat top-level collection).
  await deleteAllDocsInBatches(db.collection("task_assignments"), "task_assignments", { dryRun });

  // 3. tasks itself, last (after its subcollections are already gone).
  await deleteAllDocsInBatches(db.collection("tasks"), "tasks", { dryRun });

  console.log(dryRun ? "Dry run complete - nothing was deleted." : "Done.");
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("delete-legacy-task-firestore-data failed:", err);
    process.exit(1);
  });
