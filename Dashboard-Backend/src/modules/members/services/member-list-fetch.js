/**
 * Firestore getAll in batches of 10.
 * @param {import("firebase-admin/firestore").Firestore} db
 * @param {string[]} memberIds
 * @returns {Promise<import("firebase-admin/firestore").QueryDocumentSnapshot[]>}
 */
export async function fetchMemberDocsByIds(db, memberIds) {
  if (!memberIds.length) return [];
  const unique = [...new Set(memberIds.filter((id) => typeof id === "string" && id.length > 0))];
  const snaps = [];
  for (let i = 0; i < unique.length; i += 10) {
    const batch = unique.slice(i, i + 10).map((id) => db.collection("members").doc(id));
    snaps.push(...(await db.getAll(...batch)));
  }
  return snaps.filter((snap) => snap.exists);
}
