import { pickHighestPrivilegeRoleName } from "./relation-sync.js";

export async function resolveMemberRoleName(db, memberId) {
  const [memberSnap, rolesSnap] = await Promise.all([
    db.collection("members").doc(memberId).get(),
    db.collection("roles").limit(100).get(),
  ]);
  if (!memberSnap.exists) return "Viewer";
  const roleNameById = new Map(
    rolesSnap.docs.map((doc) => {
      const row = doc.data() || {};
      return [doc.id, typeof row.name === "string" ? row.name.trim() : ""];
    }),
  );
  const memberRoleId = typeof memberSnap.data()?.role_id === "string" ? memberSnap.data().role_id : "";
  const roleName = memberRoleId ? roleNameById.get(memberRoleId) : "";
  return pickHighestPrivilegeRoleName([roleName || "Viewer"]);
}
