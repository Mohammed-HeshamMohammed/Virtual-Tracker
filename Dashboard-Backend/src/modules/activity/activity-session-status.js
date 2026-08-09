import { getActivitySessionStaleMs } from "../../config/activity-session.js";
import { fetchAllOpenPgSessions, findOpenPgSession } from "../../lib/postgres/activity-events-postgres.service.js";

function timestampMs(value) {
  if (!value) return 0;
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
 * Latest open session per member.
 * @returns {Promise<Map<string, Record<string, unknown>>>}
 */
export async function buildOpenSessionIndex() {
  const rows = await fetchAllOpenPgSessions();
  const byMember = new Map();
  for (const row of rows) {
    const memberId = typeof row.member_id === "string" ? row.member_id : String(row.member_id ?? "");
    if (!memberId) continue;
    const prev = byMember.get(memberId);
    if (!prev || timestampMs(row.updated_at) >= timestampMs(prev.updated_at)) {
      byMember.set(memberId, row);
    }
  }
  return byMember;
}

/** @param {string} memberId */
export async function findOpenSessionForMember(memberId) {
  return findOpenPgSession(memberId);
}

/**
 * Add tracking_status + last_presence_at from open activity session.
 * @param {Array<Record<string, unknown> & { id: string }>} members
 */
export async function enrichMembersWithSessionStatus(members) {
  if (!members.length) return members;
  const index = await buildOpenSessionIndex();
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
