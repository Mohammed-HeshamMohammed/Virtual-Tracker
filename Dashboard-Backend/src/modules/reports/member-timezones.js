import { query as pgQuery } from "../../lib/postgres/client.js";

const VALID_TIMEZONES = new Set(Intl.supportedValuesOf("timeZone"));

function normalizeTimezone(value) {
  const tz = typeof value === "string" ? value.trim() : "";
  return tz && VALID_TIMEZONES.has(tz) ? tz : "UTC";
}

export async function getMemberTimezones(db, memberIds) {
  const tzByMember = new Map();
  if (!memberIds || memberIds.length === 0) return tzByMember;

  const rows = await pgQuery("SELECT id, timezone FROM members WHERE id = ANY($1)", [memberIds]);
  for (const row of rows) {
    if (row.id) tzByMember.set(row.id, normalizeTimezone(row.timezone));
  }
  return tzByMember;
}
