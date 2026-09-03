import { ensureEntityDiagramForAuthUser, ensureOrganizationEntities } from "../../../bootstrap/entity-bootstrap.js";
import { getMemberByFirebaseUidPg, getMemberByIdPg, updateMemberPg } from "../../../lib/postgres/members-postgres.service.js";
import { reconcileMemberNamesFromProfile } from "../../auth/profile-settings.js";
import { ensureMemberRowForUserRecord } from "./ensure-member-from-auth.js";
import { getMemberPresence } from "./member-presence.service.js";
import { alignMemberRoleTables } from "./relation-sync.js";

async function reconcileMemberNamesSafe(db, uid, memberId) {
  if (!memberId) return;
  try {
    await reconcileMemberNamesFromProfile(db, uid, memberId);
  } catch {
    // Non-fatal: member list may lag profile until next profile save.
  }
}

async function hasBootstrapMarker(db, memberId) {
  const memberRow = await getMemberByIdPg(memberId);
  if (!memberRow) return false;
  if (memberRow.profile_linked_records_at) return true;
  const legacy = await getMemberPresence(db, memberId);
  return Boolean(legacy?.profile_linked_records_at);
}

export async function ensureMemberLinkedRecordsForUserRecord(db, userRecord) {
  const uid = userRecord.uid;

  if (uid) {
    const existingPg = await getMemberByFirebaseUidPg(uid);
    if (existingPg) {
      const memberId = String(existingPg.id);
      if (await hasBootstrapMarker(db, memberId)) {
        await reconcileMemberNamesSafe(db, uid, memberId);
        return { memberId, created: [], skipped: "already_bootstrapped" };
      }
    }
  }

  const ensuredMember = await ensureMemberRowForUserRecord(db, userRecord);

  let memberId = ensuredMember.memberId;
  let memberData = null;

  if (memberId) {
    memberData = await getMemberByIdPg(memberId);
  }

  if (!memberId) {
    await ensureOrganizationEntities(db, uid || "auth-auto-init", { deferMaintenance: true });
    return {
      memberId: null,
      created: [],
      skipped: ensuredMember.skipped || "member_not_found",
    };
  }

  const needsBootstrapMarker = !(await hasBootstrapMarker(db, memberId));

  const { org, member } = await ensureEntityDiagramForAuthUser(db, userRecord, {
    memberId,
    memberData: memberData || {},
  });

  const created = [...org.created, ...member.created];

  if (!needsBootstrapMarker && created.length === 0) {
    await alignMemberRoleTables(db, memberId, userRecord.uid || "auth-bootstrap");
    await reconcileMemberNamesSafe(db, uid, memberId);
    return { memberId, created, skipped: "already_bootstrapped" };
  }

  await alignMemberRoleTables(db, memberId, userRecord.uid || "auth-bootstrap");
  await reconcileMemberNamesSafe(db, uid, memberId);

  if (needsBootstrapMarker) {
    await updateMemberPg(memberId, {
      profile_linked_records_at: new Date(),
    });
  }

  return { memberId, created };
}
