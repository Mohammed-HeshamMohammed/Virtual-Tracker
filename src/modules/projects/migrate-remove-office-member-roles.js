import { getDb } from "../../config/firebase.js";
import { getSystemMetaDoc, setSystemMetaDoc } from "../../lib/postgres/member-data-store.js";
import { query as pgQuery } from "../../lib/postgres/client.js";

const MARKER_DOC = "project_office_member_roles_removed";

function isOfficeMemberProjectRole(value) {
  const role = String(value || "")
    .trim()
    .toLowerCase();
  return role === "member" || role === "members";
}

/** One-off: delete project_members rows with office "member" role. */
export async function removeProjectOfficeMemberRoles() {
  const db = getDb();
  if (!db) {
    return { success: false, reason: "db_not_available" };
  }

  const marker = await getSystemMetaDoc(db, MARKER_DOC);
  if (marker?.completed === true) {
    return { success: true, alreadyCompleted: true, deleted: 0 };
  }

  // project_members is Postgres-backed now (see PROPOSAL-Projects-Migration-to-PostgreSQL.md).
  const rows = await pgQuery("SELECT id, project_role FROM project_members");
  const idsToDelete = rows.filter((row) => isOfficeMemberProjectRole(row.project_role)).map((row) => row.id);
  let deleted = 0;
  if (idsToDelete.length > 0) {
    await pgQuery("DELETE FROM project_members WHERE id = ANY($1::uuid[])", [idsToDelete]);
    deleted = idsToDelete.length;
  }

  await setSystemMetaDoc(db, MARKER_DOC, {
    completed: true,
    deletedCount: deleted,
    scannedCount: rows.length,
    completedAt: new Date().toISOString(),
  });

  console.info(
    `[project-office-member-roles-migration] Scanned ${rows.length} project member links; deleted ${deleted}.`,
  );

  return { success: true, deleted };
}
