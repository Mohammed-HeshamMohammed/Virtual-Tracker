import { getMembersByIdsPg } from "../../../lib/postgres/members-postgres.service.js";

export async function fetchMemberDocsByIds(_db, memberIds) {
  if (!memberIds.length) return [];
  const rows = await getMembersByIdsPg(memberIds);
  return rows.map((row) => ({ id: String(row.id), data: () => row }));
}
