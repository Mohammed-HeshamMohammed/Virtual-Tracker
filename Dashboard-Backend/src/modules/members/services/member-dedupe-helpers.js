/**
 * Shared dedupe helpers for top-level member-scoped collections.
 */

function timestampMs(value) {
  if (!value) return 0;
  if (typeof value?.toDate === "function") return value.toDate().getTime();
  if (value instanceof Date) return value.getTime();
  return 0;
}

function pickLatestDoc(docs) {
  if (docs.length <= 1) return docs[0] ?? null;
  return [...docs].sort((a, b) => timestampMs(b.data()?.updated_at) - timestampMs(a.data()?.updated_at))[0];
}

/**
 * @param {import("firebase-admin/firestore").Firestore} db
 * @param {string} collection
 * @param {string} memberId
 * @param {(data: Record<string, unknown>) => string} [groupKey]
 */
export async function dedupeByMemberId(db, collection, memberId, groupKey = () => "") {
  const snap = await db.collection(collection).where("member_id", "==", memberId).get();
  if (snap.size <= 1) return 0;

  const groups = new Map();
  for (const doc of snap.docs) {
    const key = groupKey(doc.data() || {});
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(doc);
  }

  const batch = db.batch();
  let deleted = 0;
  for (const docs of groups.values()) {
    if (docs.length <= 1) continue;
    const keep = pickLatestDoc(docs);
    if (!keep) continue;
    for (const doc of docs) {
      if (doc.id !== keep.id) {
        batch.delete(doc.ref);
        deleted++;
      }
    }
  }
  if (deleted > 0) await batch.commit();
  return deleted;
}
