// Timezone lookup scoped to reports - deliberately not folded into the shared
// buildMemberMetaMap (activity/activity-scope.js), which other unrelated features
// also call. Isolating this here costs one extra small Firestore batch-read per
// report call versus merging into that existing name lookup; fine at this call
// volume - revisit if reports become hot-path.
const VALID_TIMEZONES = new Set(Intl.supportedValuesOf("timeZone"));

/** @param {unknown} value */
function normalizeTimezone(value) {
  const tz = typeof value === "string" ? value.trim() : "";
  return tz && VALID_TIMEZONES.has(tz) ? tz : "UTC";
}

/**
 * @param {import("firebase-admin/firestore").Firestore} db
 * @param {string[]} memberIds
 * @returns {Promise<Map<string, string>>} memberId -> IANA timezone, "UTC" when unset/invalid
 */
export async function getMemberTimezones(db, memberIds) {
  const tzByMember = new Map();
  if (memberIds.length === 0) return tzByMember;

  for (let i = 0; i < memberIds.length; i += 10) {
    const chunk = memberIds.slice(i, i + 10);
    const refs = chunk.map((id) => db.collection("members").doc(id));
    const docs = await db.getAll(...refs);
    for (const doc of docs) {
      if (!doc.exists) continue;
      tzByMember.set(doc.id, normalizeTimezone(doc.data()?.timezone));
    }
  }
  return tzByMember;
}
