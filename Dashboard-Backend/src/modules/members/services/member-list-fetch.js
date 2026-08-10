import { getMembersByIdsPg } from "../../../lib/postgres/members-postgres.service.js";

/**
 * Postgres members by id, wrapped in a minimal Firestore-QueryDocumentSnapshot
 * shape ({ id, data() }) so the large existing downstream pipeline
 * (mapMembersWithProfilePhotos, enrichMembersWithRelationsFromSnaps, etc. in
 * compat/routes.js) needs zero changes - they only ever call .id/.data() on
 * what this returns, never anything Firestore-specific like .ref/.exists.
 * @param {import("firebase-admin/firestore").Firestore} _db
 * @param {string[]} memberIds
 * @returns {Promise<{ id: string, data: () => Record<string, unknown> }[]>}
 */
export async function fetchMemberDocsByIds(_db, memberIds) {
  if (!memberIds.length) return [];
  const rows = await getMembersByIdsPg(memberIds);
  return rows.map((row) => ({ id: String(row.id), data: () => row }));
}
