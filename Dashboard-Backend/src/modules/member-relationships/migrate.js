import { getDb } from "../../config/firebase.js";
import { logSafeError } from "../../http/sanitize-error.js";
import { query as pgQuery } from "../../lib/postgres/client.js";
import { clearAllMemberTreeCachePg } from "../../lib/postgres/member-data-postgres.service.js";
import { listMembersPg } from "../../lib/postgres/members-postgres.service.js";
import { recordMemberRelationship, updateTreeCache } from "./service.js";

export async function initializeMemberRelationships() {
  const db = getDb();
  if (!db) {
    console.log("[member-relationships-migration] DB not available, skipping");
    return { success: false, reason: "db_not_available" };
  }

  const existingRel = await pgQuery("SELECT 1 FROM member_relationships LIMIT 1");
  if (existingRel.length) {
    return { success: true, alreadyCompleted: true, reason: "relationships_already_exist" };
  }

  const members = await listMembersPg({ limit: 500 });
  if (!members.length) {
    return { success: true, membersProcessed: 0, reason: "no_members" };
  }

  console.log(`[member-relationships-migration] Found ${members.length} members to process`);
  const results = {
    processed: 0,
    relationshipsCreated: 0,
    rootMembers: [],
    errors: [],
  };

  const sortedByDate = [...members].sort((a, b) => {
    const aDate = a.date_added?.toDate?.() || new Date(a.date_added || 0);
    const bDate = b.date_added?.toDate?.() || new Date(b.date_added || 0);
    return aDate - bDate;
  });

  const oldestMember = sortedByDate[0];
  if (oldestMember) {
    results.rootMembers.push(oldestMember.id);
    console.log(`[member-relationships-migration] Root member identified: ${oldestMember.id}`);
  }

  for (const member of members) {
    try {
      results.processed++;

      if (results.rootMembers.includes(member.id)) {
        console.log(`[member-relationships-migration] Skipping root member: ${member.id}`);
        continue;
      }

      let parentId = null;
      let relationshipType = "admin_create";

      if (member.created_by_uid) {
        const parentByUid = members.find(m => m.firebase_uid === member.created_by_uid);
        if (parentByUid) {
          parentId = parentByUid.id;
          relationshipType = member.created_by === "self-invite" ? "invite" :
                            member.created_by === "invite-preprovision" ? "preprovision" :
                            "admin_create";
        }
      }

      if (!parentId && oldestMember && oldestMember.id !== member.id) {
        parentId = oldestMember.id;
        relationshipType = "admin_create";
      }

      if (parentId) {
        await recordMemberRelationship(db, {
          parentMemberId: parentId,
          childMemberId: member.id,
          relationshipType,
          createdBy: parentId,
        });
        results.relationshipsCreated++;
        console.log(`[member-relationships-migration] Created: ${parentId} -> ${member.id} (${relationshipType})`);
      } else {
        results.rootMembers.push(member.id);
        console.log(`[member-relationships-migration] No parent found, treating as root: ${member.id}`);
      }
    } catch (err) {
      logSafeError(`[member-relationships-migration] Error processing ${member.id}`, err);
      results.errors.push({ memberId: member.id, error: err.message });
    }
  }

  console.log("[member-relationships-migration] Building tree cache...");
  for (const member of members) {
    try {
      await updateTreeCache(db, member.id);
    } catch (err) {
      logSafeError(`[member-relationships-migration] Cache error for ${member.id}`, err);
    }
  }

  console.log(`[member-relationships-migration] Complete: ${results.relationshipsCreated} relationships created`);

  return {
    success: true,
    membersProcessed: results.processed,
    relationshipsCreated: results.relationshipsCreated,
    rootMembers: results.rootMembers,
    errors: results.errors,
  };
}

export async function forceReinitializeRelationships() {
  const db = getDb();
  if (!db) return { success: false, reason: "db_not_available" };

  await pgQuery("DELETE FROM member_relationships");

  await clearAllMemberTreeCachePg();

  return initializeMemberRelationships();
}
