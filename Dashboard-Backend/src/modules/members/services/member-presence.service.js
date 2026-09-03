import {
  extractPresenceFields,
  flattenPresenceForApi,
  resolveEffectivePresence,
} from "./presence-status.js";
import { getMemberByFirebaseUidPg, getMemberByIdPg } from "../../../lib/postgres/members-postgres.service.js";

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
  const runtime = getPresenceService().getPresence(memberId);
  return { ...memberData, ...flattenPresenceForApi(memberData, runtime) };
}

export async function enrichMembersWithPresenceBatch(_db, members) {
  if (!members.length) return members;
  const { getPresenceService } = await import("../../presence/index.js");
  const presenceService = getPresenceService();
  const ids = members.map((member) => member.id);
  const presenceMap = await presenceService.getPresenceMany(ids);
  return members.map((member) => ({
    ...member,
    ...flattenPresenceForApi(member, presenceMap.get(member.id) ?? null),
  }));
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
