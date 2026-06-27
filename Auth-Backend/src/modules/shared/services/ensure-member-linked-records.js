import { dedupeMembersForFirebaseUid } from "./member-dedupe.js";
import { ensureMemberRowForUserRecord } from "./ensure-member-from-auth.js";
import { alignMemberRoleTables } from "./relation-sync.js";

export async function ensureMemberLinkedRecordsForUserRecord(db, userRecord) {
  const uid = userRecord.uid;
  const dedupeFirst = await dedupeMembersForFirebaseUid(db, uid);
  const ensuredMember = await ensureMemberRowForUserRecord(db, userRecord);
  const dedupeAfter = await dedupeMembersForFirebaseUid(db, uid);
  const memberId = dedupeAfter.canonicalId ?? dedupeFirst.canonicalId ?? ensuredMember.memberId;
  if (!memberId) {
    return { memberId: null, created: [], skipped: ensuredMember.skipped || "member_not_found" };
  }
  await alignMemberRoleTables(db, memberId, uid || "auth-bootstrap");
  return { memberId, created: [], deduped: [...dedupeFirst.removed, ...dedupeAfter.removed] };
}
