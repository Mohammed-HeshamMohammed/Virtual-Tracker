import { getActivitySessionStaleMs } from "../../config/activity-session.js";

function timestampMs(value) {
  if (!value) return 0;
  if (typeof value?.toDate === "function") return value.toDate().getTime();
  if (value instanceof Date) return value.getTime();
  const ms = Date.parse(String(value));
  return Number.isFinite(ms) ? ms : 0;
}

/**
 * @param {{ status?: string, updated_at?: unknown, ended_at?: unknown } | null | undefined} session
 * @returns {"online"|"active"|"tracking"|"idle"|"offline"}
 */
export function effectiveTrackingStatusFromSession(session) {
  if (!session || session.ended_at != null) return "offline";
  const updatedMs = timestampMs(session.updated_at ?? session.started_at);
  if (!updatedMs || Date.now() - updatedMs > getActivitySessionStaleMs()) return "offline";
  const status = String(session.status || "").toLowerCase();
  if (status === "active") return "active";
  if (status === "idle") return "idle";
  return "offline";
}

/**
 * Latest open session per member_id (ended_at == null).
 *
 * @param {import("firebase-admin/firestore").Firestore} db
 * @returns {Promise<Map<string, Record<string, unknown>>>}
 */
export async function buildOpenSessionIndex(db) {
  const snap = await db
    .collection("activity_sessions")
    .select("member_id", "status", "updated_at", "started_at", "ended_at", "task_id")
    .limit(500)
    .get();

  const byMember = new Map();
  for (const doc of snap.docs) {
    const data = doc.data() || {};
    if (data.ended_at != null) continue;
    const memberId = typeof data.member_id === "string" ? data.member_id : "";
    if (!memberId) continue;
    const row = { id: doc.id, ...data };
    const prev = byMember.get(memberId);
    if (!prev || timestampMs(row.updated_at) >= timestampMs(prev.updated_at)) {
      byMember.set(memberId, row);
    }
  }
  return byMember;
}

/**
 * @param {import("firebase-admin/firestore").Firestore} db
 * @param {string} memberId
 */
export async function findOpenSessionForMember(db, memberId) {
  const snap = await db.collection("activity_sessions").where("member_id", "==", memberId).limit(40).get();
  const open = snap.docs
    .filter((d) => d.data()?.ended_at == null)
    .sort((a, b) => timestampMs(b.data()?.updated_at) - timestampMs(a.data()?.updated_at));
  if (!open.length) return null;
  const doc = open[0];
  return { id: doc.id, ...doc.data() };
}

/**
 * Attach session-derived `tracking_status` and `last_presence_at` (from session.updated_at) for API responses.
 *
 * @param {import("firebase-admin/firestore").Firestore} db
 * @param {Array<Record<string, unknown> & { id: string }>} members
 */
export async function enrichMembersWithSessionStatus(db, members) {
  if (!members.length) return members;
  const index = await buildOpenSessionIndex(db);
  return members.map((m) => {
    const session = index.get(m.id) ?? null;
    const trackingStatus = effectiveTrackingStatusFromSession(session);
    const updatedAt = session?.updated_at ?? null;
    return {
      ...m,
      tracking_status: trackingStatus,
      last_presence_at: updatedAt,
    };
  });
}
