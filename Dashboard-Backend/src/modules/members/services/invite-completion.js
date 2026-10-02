// An invite is "completed" when the person it was for becomes a member. The web invite link
// (member-invites.routes.js, /register) does that itself, but people also arrive by signing in
// straight from the tracker (or any other sign-in), which creates the member through
// ensure-member-from-auth.js and never touched the invite: it sat in the Invites tab as
// "Awaiting signup" for someone already working, and the member came out as a bare Viewer with
// no projects instead of what the inviter chose. This is the one place that closes that gap.
import { query } from "../../../lib/postgres/client.js";
import { logSafeError, logSafeWarn } from "../../../http/sanitize-error.js";
import { isExcludedFromHierarchy } from "../../hierarchy/hierarchy-placement.js";
import { isInviteExpired } from "./invite-lifecycle.js";

export function normalizeInviteEmail(value) {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

/** The newest still-valid email invite addressed to `email`, or null. */
export async function findPendingInviteForEmail(email, { tenantId = null } = {}) {
  const normalized = normalizeInviteEmail(email);
  if (!normalized) return null;
  const rows = await query(
    `SELECT * FROM invites
      WHERE lower(email) = $1
        AND status = 'pending_signup'
        AND COALESCE(invite_kind, 'email') = 'email'
        AND ($2::text IS NULL OR tenant_id::text = $2)
      ORDER BY sent_at DESC
      LIMIT 5`,
    [normalized, tenantId],
  );
  return rows.find((row) => !isInviteExpired(row)) ?? null;
}

/**
 * Marks every pending email invite for a member who has joined as completed. Returns how many.
 * Expired ones are closed too: the person is a member now, so none of them is "awaiting".
 */
export async function completeInvitesForJoinedMember({ email, uid = "", tenantId = null }) {
  const normalized = normalizeInviteEmail(email);
  if (!normalized) return 0;
  const rows = await query(
    `UPDATE invites
        SET status = 'completed',
            accepted_at = now(),
            firebase_uid = COALESCE(NULLIF($2, ''), firebase_uid),
            use_count = COALESCE(use_count, 0) + 1,
            updated_at = now()
      WHERE lower(email) = $1
        AND status = 'pending_signup'
        AND COALESCE(invite_kind, 'email') = 'email'
        AND ($3::text IS NULL OR tenant_id::text = $3)
      RETURNING id`,
    [normalized, uid, tenantId],
  );
  return rows.length;
}

/**
 * Gives a member who just signed in the things their invite carried: role, pay rate, projects
 * and place in the tree - what /register does for the web link. Never throws: the sign-in has
 * already succeeded and must not fail because an invite could not be applied.
 */
export async function applyInviteToNewMember(db, { memberId, uid, invite }) {
  if (!memberId || !invite) return { applied: false };
  const steps = [];
  try {
    const [{ resolveRoleNameById, syncMemberPrimaryRole, getInviteProjectIds, syncProjectMembersForMember }, { upsertMemberPayRate }, { recordMemberRelationship }, { getMemberByFirebaseUidPg }, { resolveMemberRoleName }] =
      await Promise.all([
        import("./relation-sync.js"),
        import("./member-profile.service.js"),
        import("../../member-relationships/service.js"),
        import("../../../lib/postgres/members-postgres.service.js"),
        import("../../activity/activity-scope.js"),
      ]);
    const inviterUid = typeof invite.created_by_uid === "string" ? invite.created_by_uid : "";

    const roleName = (await resolveRoleNameById(db, typeof invite.role_id === "string" ? invite.role_id : "")) || "";
    if (roleName) {
      let creatorRole = "";
      const creatorMemberId = typeof invite.created_by === "string" ? invite.created_by.trim() : "";
      if (creatorMemberId) creatorRole = await resolveMemberRoleName(db, creatorMemberId);
      await syncMemberPrimaryRole(db, memberId, roleName, inviterUid, creatorRole);
      steps.push("role");
    }

    const payRate = typeof invite.pay_rate === "number" && !Number.isNaN(invite.pay_rate) ? invite.pay_rate : 0;
    if (payRate > 0) {
      await upsertMemberPayRate(db, memberId, payRate, inviterUid);
      steps.push("pay");
    }

    const projectIds = await getInviteProjectIds(db, String(invite.id));
    if (projectIds.length > 0) {
      await syncProjectMembersForMember(db, memberId, projectIds, inviterUid);
      steps.push("projects");
    }

    if (inviterUid && !isExcludedFromHierarchy(roleName || "Viewer")) {
      const inviter = await getMemberByFirebaseUidPg(inviterUid);
      if (inviter) {
        const inviterMemberId = String(inviter.id);
        const requestedParent = typeof invite.tree_parent_member_id === "string" ? invite.tree_parent_member_id : "";
        let parentMemberId = inviterMemberId;
        if (requestedParent && requestedParent !== inviterMemberId) {
          const rows = await query("SELECT id FROM members WHERE id = $1 AND status = 'active' LIMIT 1", [requestedParent]);
          if (rows.length) parentMemberId = requestedParent;
        }
        await recordMemberRelationship(db, {
          parentMemberId,
          childMemberId: memberId,
          relationshipType: "invite",
          createdBy: inviterMemberId,
          projects: projectIds,
        });
        steps.push("tree");
      }
    }
    return { applied: true, steps };
  } catch (error) {
    logSafeError("[invite-completion] could not apply the invite to the new member", error);
    return { applied: steps.length > 0, steps, error: true };
  }
}

/**
 * For the Invites list: closes (and drops from the result) any pending email invite whose
 * address already belongs to an active member. Heals the invites left behind before sign-ins
 * completed them. Best effort - a failure leaves the list as it was.
 */
export async function dropInvitesOfJoinedMembers(rows, tenantId) {
  try {
    const pending = rows.filter(
      (row) =>
        row.status === "pending_signup" &&
        (row.invite_kind ?? "email") === "email" &&
        normalizeInviteEmail(row.email),
    );
    if (pending.length === 0) return rows;
    const emails = [...new Set(pending.map((row) => normalizeInviteEmail(row.email)))];
    const joined = await query(
      `SELECT lower(work_email) AS e, lower(personal_email) AS p
         FROM members
        WHERE status = 'active'
          AND (lower(work_email) = ANY($1::text[]) OR lower(personal_email) = ANY($1::text[]))`,
      [emails],
    );
    const joinedEmails = new Set(joined.flatMap((row) => [row.e, row.p]).filter(Boolean));
    const stale = pending.filter((row) => joinedEmails.has(normalizeInviteEmail(row.email)));
    if (stale.length === 0) return rows;
    for (const email of new Set(stale.map((row) => normalizeInviteEmail(row.email)))) {
      await completeInvitesForJoinedMember({ email, tenantId });
    }
    const staleIds = new Set(stale.map((row) => String(row.id)));
    return rows.filter((row) => !staleIds.has(String(row.id)));
  } catch (error) {
    logSafeWarn("[invite-completion] could not check invites against members", error);
    return rows;
  }
}
