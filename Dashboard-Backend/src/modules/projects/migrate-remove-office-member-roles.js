import { getDb } from "../../config/firebase.js";

const MARKER_DOC = "project_office_member_roles_removed";

function isOfficeMemberProjectRole(value) {
  const role = String(value || "")
    .trim()
    .toLowerCase();
  return role === "member" || role === "members";
}

/**
 * Deletes deprecated `project_members` rows that used the office-member project role.
 *
 * @returns {Promise<{ success: boolean; alreadyCompleted?: boolean; deleted?: number; reason?: string }>}
 */
export async function removeProjectOfficeMemberRoles() {
  const db = getDb();
  if (!db) {
    return { success: false, reason: "db_not_available" };
  }

  const markerRef = db.collection("system_meta").doc(MARKER_DOC);
  const markerSnap = await markerRef.get();
  if (markerSnap.exists && markerSnap.data()?.completed === true) {
    return { success: true, alreadyCompleted: true, deleted: 0 };
  }

  const linksSnap = await db.collection("project_members").get();
  let deleted = 0;
  let batch = db.batch();
  let batchCount = 0;

  for (const doc of linksSnap.docs) {
    const data = doc.data() || {};
    const role = data.project_role ?? data.projectRole;
    if (!isOfficeMemberProjectRole(role)) continue;

    batch.delete(doc.ref);
    batchCount += 1;
    deleted += 1;

    if (batchCount >= 400) {
      await batch.commit();
      batch = db.batch();
      batchCount = 0;
    }
  }

  if (batchCount > 0) {
    await batch.commit();
  }

  await markerRef.set(
    {
      completed: true,
      deletedCount: deleted,
      scannedCount: linksSnap.size,
      completedAt: new Date(),
    },
    { merge: true },
  );

  console.info(
    `[project-office-member-roles-migration] Scanned ${linksSnap.size} project member links; deleted ${deleted}.`,
  );

  return { success: true, deleted };
}
