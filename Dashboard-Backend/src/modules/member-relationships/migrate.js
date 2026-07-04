import { getDb } from "../../config/firebase.js";
import { logSafeError } from "../../http/sanitize-error.js";
import { clearAllMemberTreeCachePg } from "../../lib/postgres/member-data-postgres.service.js";
import { recordMemberRelationship, updateTreeCache } from "./service.js";

/**
 * Check if member_relationships collection needs to be initialized
 * and auto-create relationships for existing members.
 * Stateless: just checks if relationships exist and creates if not.
 */
export async function initializeMemberRelationships() {
  const db = getDb();
  if (!db) {
    console.log("[member-relationships-migration] DB not available, skipping");
    return { success: false, reason: "db_not_available" };
  }

  // Check if there are any existing relationships - if yes, skip
  const existingRel = await db.collection("member_relationships").limit(1).get();
  if (!existingRel.empty) {
    return { success: true, alreadyCompleted: true, reason: "relationships_already_exist" };
  }

  // Check if there are members to migrate
  const membersSnap = await db.collection("members").limit(500).get();
  if (membersSnap.empty) {
    return { success: true, membersProcessed: 0, reason: "no_members" };
  }

  console.log(`[member-relationships-migration] Found ${membersSnap.size} members to process`);

  const members = membersSnap.docs.map(d => ({ id: d.id, ...d.data() }));
  const results = {
    processed: 0,
    relationshipsCreated: 0,
    rootMembers: [],
    errors: [],
  };

  // Find potential root members (oldest members or admin/owner roles)
  const sortedByDate = [...members].sort((a, b) => {
    const aDate = a.date_added?.toDate?.() || new Date(a.date_added || 0);
    const bDate = b.date_added?.toDate?.() || new Date(b.date_added || 0);
    return aDate - bDate;
  });

  // First member(s) become root nodes
  const oldestMember = sortedByDate[0];
  if (oldestMember) {
    results.rootMembers.push(oldestMember.id);
    console.log(`[member-relationships-migration] Root member identified: ${oldestMember.id}`);
  }

  // Process each member to create relationships
  for (const member of members) {
    try {
      results.processed++;

      // Skip if this is a root member
      if (results.rootMembers.includes(member.id)) {
        console.log(`[member-relationships-migration] Skipping root member: ${member.id}`);
        continue;
      }

      // Determine parent based on created_by_uid or created_by
      let parentId = null;
      let relationshipType = "admin_create";

      // Check if created_by_uid exists and matches another member
      if (member.created_by_uid) {
        const parentByUid = members.find(m => m.firebase_uid === member.created_by_uid);
        if (parentByUid) {
          parentId = parentByUid.id;
          relationshipType = member.created_by === "self-invite" ? "invite" :
                            member.created_by === "invite-preprovision" ? "preprovision" :
                            "admin_create";
        }
      }

      // If no parent found by UID, use oldest member as default parent
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

  // Build tree cache for all members
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

/**
 * Force re-initialization (admin use only)
 */
export async function forceReinitializeRelationships() {
  const db = getDb();
  if (!db) return { success: false, reason: "db_not_available" };

  // Clear existing relationships
  const batch = db.batch();
  const existing = await db.collection("member_relationships").limit(500).get();
  for (const doc of existing.docs) {
    batch.delete(doc.ref);
  }
  await batch.commit();

  // Clear tree cache (PostgreSQL)
  await clearAllMemberTreeCachePg();

  // Re-run migration
  return initializeMemberRelationships();
}
