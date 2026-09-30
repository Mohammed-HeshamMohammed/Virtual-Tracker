import {
  extractPresenceFields,
  flattenPresenceForApi,
  presenceWithOpenSession,
  resolveEffectivePresence,
} from "./presence-status.js";
import { getMemberByFirebaseUidPg, getMemberByIdPg } from "../../../lib/postgres/members-postgres.service.js";

// Loaded on first use, like the presence runtime below: activity-session-status pulls in the
// activity database layer, which nothing else that imports this file needs.
async function sessionStatusApi() {
  return import("../../activity/activity-session-status.js");
}

export async function resolveMemberIdForUid(_db, firebaseUid) {
  if (!firebaseUid) return "";
  const member = await getMemberByFirebaseUidPg(firebaseUid);
  return member ? String(member.id) : "";
}

export async function getMemberPresence(_db, memberId) {
  const member = await getMemberByIdPg(memberId);
  if (!member) return null;
  const fields = extractPresenceFields(member);
  return fields.last_seen_at || fields.profile_linked_records_at ? fields : null;
}

export async function enrichMemberWithPresence(_db, memberId, memberData) {
  const { getPresenceService } = await import("../../presence/index.js");
  let runtime = getPresenceService().getPresence(memberId);
  if (runtime.status === "offline") {
    const { buildOpenSessionIndex, effectiveTrackingStatusFromSession } = await sessionStatusApi();
    const session = (await buildOpenSessionIndex().catch(() => null))?.get(memberId) ?? null;
    runtime = presenceWithOpenSession(runtime, effectiveTrackingStatusFromSession(session), session?.updated_at);
  }
  return { ...memberData, ...flattenPresenceForApi(memberData, runtime) };
}

export async function enrichMembersWithPresenceBatch(_db, members) {
  if (!members.length) return members;
  const { getPresenceService } = await import("../../presence/index.js");
  const presenceService = getPresenceService();
  const ids = members.map((member) => member.id);
  const presenceMap = await presenceService.getPresenceMany(ids);
  // One read of the open sessions, and only when someone reads offline: it is the fallback for
  // a tracker that is logging time with its presence socket down (see presenceWithOpenSession).
  const anyOffline = ids.some((id) => (presenceMap.get(id)?.status ?? "offline") === "offline");
  const { buildOpenSessionIndex, effectiveTrackingStatusFromSession } = anyOffline
    ? await sessionStatusApi()
    : { buildOpenSessionIndex: null, effectiveTrackingStatusFromSession: null };
  const sessions = buildOpenSessionIndex ? await buildOpenSessionIndex().catch(() => null) : null;
  return members.map((member) => {
    let presence = presenceMap.get(member.id) ?? null;
    if (sessions) {
      const session = sessions.get(member.id) ?? null;
      presence = presenceWithOpenSession(presence, effectiveTrackingStatusFromSession(session), session?.updated_at);
    }
    return { ...member, ...flattenPresenceForApi(member, presence) };
  });
}

export async function patchMemberPresence(_db, memberId, patch) {
  const { getPresenceService } = await import("../../presence/index.js");
  const presenceService = getPresenceService();
  const status = typeof patch.tracking_status === "string" ? patch.tracking_status.trim().toLowerCase() : "";
  if (status === "online") presenceService.markOnline(memberId);
  else if (status === "idle") presenceService.markIdle(memberId);
  else presenceService.markOffline(memberId);
  const runtime = presenceService.getPresence(memberId);
  return { applied: true, presence: resolveEffectivePresence(runtime, {}) };
}
