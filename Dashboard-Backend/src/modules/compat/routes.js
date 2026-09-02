import crypto from "node:crypto";
import { getAuthAdmin } from "../../config/firebase.js";
import { isPostgresConfigured, query } from "../../lib/postgres/client.js";
import { createOrgFieldOptionPg, listOrgFieldOptionsPg, ORG_FIELD_OPTION_TYPES } from "../../lib/postgres/lookup-postgres.service.js";
import { listMemberFormSnapshotsPg } from "../../lib/postgres/member-form-snapshot-postgres.service.js";
import { getAuthContext, requireManagementRole } from "../../http/auth-context.js";
import { isOrgProjectAdminRole } from "../../http/project-access.js";
import { canUseBatchMemberActions, assertMembersRemovable, BATCH_MEMBER_ACTIONS_DENIED_MESSAGE } from "../../http/batch-member-actions.js";
import { canAccessMember, canManageMember } from "../../http/authorization.js";
import { canViewerManageInvite } from "../../http/invite-scope.js";
import { validateMemberRoleChange, validateRoleAssignment } from "../../http/role-assignment-guard.js";
import { logSafeWarn } from "../../http/sanitize-error.js";
import { applyMemberFieldPolicy, redactProfileFormCompensation } from "../../http/field-policy.js";
import { sendJson } from "../../http/response.js";
import { rejectUnknownFields } from "../../http/validate-body.js";
import { COMPAT_BODY_SCHEMAS, readCompatBody } from "./body-schemas.js";
import { sendToMember } from "../presence/index.js";
import { publishChange, subscribeChanges } from "../realtime/change-bus.js";
import { getVisibleMemberIds, recordMemberRelationship } from "../member-relationships/service.js";
import { fetchMemberDocsByIds } from "../members/services/member-list-fetch.js";
import {
  createMemberPg,
  deleteMemberPg,
  getMemberByFirebaseUidPg,
  getMemberByIdPg,
  listMembersPagePg,
  listMembersEnrichedPg,
  updateMemberPg,
} from "../../lib/postgres/members-postgres.service.js";
import { resolveEffectivePresence } from "../members/services/presence-status.js";
import { normalizeDoc } from "../schema/services/schema-crud.service.js";
import { assertEmailCanUseMemberInviteOrPreprovision } from "../members/services/eligibility.js";
import {
  cascadeDeleteMemberRelations,
  enrichMembersWithRoleNames,
  resolveRoleIdByName,
  resolveRoleNameById,
  syncInviteProjects,
  alignMemberRoleTables,
  syncMemberPrimaryRole,
  syncProjectMembersForMember,
} from "../members/services/relation-sync.js";
import { resolveProfileAvatarUrl } from "../auth/profile-image-resolve.js";
import { resolveMemberDisplayName } from "../members/services/member-display-name.js";
import { sendMemberInviteEmail } from "../auth/invite-email.js";
import { resolveAppPublicUrl } from "../auth/app-public-url.js";
import { isNotifyEmailRoutingConfigured } from "../../lib/notify/email-client.js";
import {
  isInviteExpired,
  shareLinkInviteFields,
  shouldHideInviteFromActiveList,
} from "../members/services/invite-lifecycle.js";
import {
  deleteMemberProfileData,
  getMemberProfileFormSections,
  MEMBER_PROFILE_SECTIONS,
  updateMemberProfile,
  upsertMemberFormSnapshot,
} from "../members/services/member-profile.service.js";
import {
  applyMemberRoleChange,
  getProfilePatchSections,
  isRoleOnlyProfilePatch,
  timeRoleChangeStep,
} from "../members/services/member-role-change.service.js";
import { ensureMemberLinkedRecordsForUserRecord } from "../members/services/ensure-member-linked-records.js";
import { generateMemberEmployeeId } from "../members/services/generate-employee-id.service.js";
import {
  enrichMembersWithPayAndLimitsFromDocs,
  enrichMembersWithPayAndLimits,
  fetchMemberRelationSnaps,
  fetchPayRatesForMembers,
  fetchWeeklyLimitsForMembers,
} from "../members/services/member-list-enrichment.js";

/**
 * Wraps a Postgres row in the minimal Firestore-doc shape expected by
 * mapMembersWithProfilePhotos and the rest of the enrichment pipeline.
 * @param {Record<string, unknown> | null | undefined} row
 * @returns {{ id: string; data: () => Record<string, unknown> } | null}
 */
function pgRowToDocShim(row) {
  if (!row) return null;
  return { id: String(row.id), data: () => row };
}

/**
 * @param {import("node:http").IncomingMessage} req
 * @param {import("firebase-admin/firestore").Firestore} db
 * @param {string} memberId
 */
async function isMemberVisibleToViewer(req, db, memberId) {
  const viewer = getAuthContext(req);
  if (!viewer) return false;
  const visibleIds = await getVisibleMemberIds(db, viewer.memberId, viewer.roleName);
  if (visibleIds === null) return true;
  return visibleIds.includes(memberId);
}

/**
 * @param {import("node:http").IncomingMessage} req
 * @param {import("firebase-admin/firestore").Firestore} db
 * @param {string} memberId
 */
async function isMemberManageableByViewer(req, db, memberId) {
  const viewer = getAuthContext(req);
  if (!viewer) return false;
  if (viewer.memberId === memberId) return true;
  return canManageMember(db, viewer.memberId, viewer.roleName, memberId);
}

/**
 * @param {import("firebase-admin/firestore").Firestore} db
 * @param {string} memberId
 * @param {ReturnType<typeof getAuthContext>} viewer
 */
async function buildRoleChangeMemberResponse(db, memberId, viewer) {
  const row = await getMemberByIdPg(memberId);
  if (!row) throw new Error("Member not found");
  let [member] = await mapMembersWithProfilePhotos(db, [pgRowToDocShim(row)]);
  [member] = await enrichMembersWithRoleNames(db, [member]);
  member = applyMemberFieldPolicy([member], viewer)[0] ?? member;
  return member;
}

/**
 * @param {import("firebase-admin/firestore").Firestore} db
 * @param {string} memberId
 * @param {ReturnType<typeof getAuthContext>} viewer
 * @param {string} section
 */
async function buildLightSectionMemberResponse(db, memberId, viewer, section) {
  const row = await getMemberByIdPg(memberId);
  if (!row) throw new Error("Member not found");
  let [member] = await mapMembersWithProfilePhotos(db, [pgRowToDocShim(row)]);
  [member] = await enrichMembersWithRoleNames(db, [member]);
  if (section === "payBill" || section === "workLimits") {
    [member] = await enrichMembersWithPayAndLimits(db, [member]);
  }
  member = applyMemberFieldPolicy([member], viewer)[0] ?? member;
  return member;
}

function parseWithVersion(pathname, base) {
  const escaped = base.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`^/api(?:/v1)?/${escaped}(?:/([^/]+))?(?:/([^/]+))?$`).exec(pathname);
}

function formatDate(date) {
  if (!date) return ""
  const d = date.toDate ? date.toDate() : new Date(date)
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
}

/** @param {Record<string, unknown>} doc */
function effectiveTrackingStatusFromDoc(doc) {
  if (doc && (doc.trackingStatus || doc.tracking_status)) {
    return doc.trackingStatus || doc.tracking_status;
  }
  return resolveEffectivePresence(null, doc).trackingStatus;
}

function applyWeeklyLimitUpdate(updates, weeklyLimit) {
  if (weeklyLimit === undefined || weeklyLimit === null) return;
  if (typeof weeklyLimit === "object") {
    updates.weekly_limit = weeklyLimit;
    return;
  }
  if (typeof weeklyLimit === "string") {
    const trimmed = weeklyLimit.trim();
    if (!trimmed || /^no\s/i.test(trimmed)) {
      updates.weekly_limit = null;
      return;
    }
    const numeric = Number(trimmed.replace(/[^\d.]/g, ""));
    updates.weekly_limit = Number.isFinite(numeric) ? String(numeric) : trimmed;
  }
}

async function enrichMembersWithRelations(db, members) {
  if (!members.length) return members;
  const snaps = await fetchMemberRelationSnaps(
    db,
    members.map((member) => member.id),
  );
  return enrichMembersWithRelationsFromSnaps(
    members,
    snaps.teamMembersSnap,
    snaps.teamsSnap,
    snaps.projectMembersSnap,
  );
}

function enrichMembersWithRelationsFromSnaps(members, teamMembersSnap, teamsSnap, projectMembersSnap) {
  if (!members.length) return members;
  const memberIdSet = new Set(members.map((m) => m.id));
  
  const teamNameById = new Map();
  if (teamsSnap && teamsSnap.docs) {
    for (const doc of teamsSnap.docs) {
      teamNameById.set(doc.id, typeof doc.data()?.name === "string" ? doc.data().name : "");
    }
  }
  
  const teamNamesByMember = new Map();
  const teamCountByMember = new Map();
  if (teamMembersSnap && teamMembersSnap.docs) {
    for (const doc of teamMembersSnap.docs) {
      const row = doc.data() || {};
      const memberId = typeof row.member_id === "string" ? row.member_id : "";
      const teamId = typeof row.team_id === "string" ? row.team_id : "";
      if (!memberIdSet.has(memberId) || !teamId) continue;
      teamCountByMember.set(memberId, (teamCountByMember.get(memberId) || 0) + 1);
      const teamName = teamNameById.get(teamId) || teamId;
      const list = teamNamesByMember.get(memberId) || [];
      if (!list.includes(teamName)) list.push(teamName);
      teamNamesByMember.set(memberId, list);
    }
  }
  
  const projectCountByMember = new Map();
  const projectIdsByMember = new Map();
  if (projectMembersSnap && projectMembersSnap.docs) {
    for (const doc of projectMembersSnap.docs) {
      const row = doc.data() || {};
      const memberId = typeof row.member_id === "string" ? row.member_id : "";
      const projectId = typeof row.project_id === "string" ? row.project_id : "";
      if (!memberIdSet.has(memberId)) continue;
      projectCountByMember.set(memberId, (projectCountByMember.get(memberId) || 0) + 1);
      if (projectId) {
        const list = projectIdsByMember.get(memberId) || [];
        if (!list.includes(projectId)) list.push(projectId);
        projectIdsByMember.set(memberId, list);
      }
    }
  }
  
  return members.map((member) => ({
    ...member,
    teams: teamCountByMember.get(member.id) ?? 0,
    team_names: teamNamesByMember.get(member.id) || [],
    projects: projectCountByMember.get(member.id) ?? 0,
    project_ids: projectIdsByMember.get(member.id) || [],
  }));
}

function filterMembersByRoleAndProject(members, roleNames, projectIds) {
  let result = members;
  if (Array.isArray(roleNames) && roleNames.length > 0) {
    const roleSet = new Set(roleNames.filter((name) => typeof name === "string" && name.length > 0));
    if (roleSet.size > 0) {
      result = result.filter((member) => roleSet.has(member.role_name || member.role || ""));
    }
  }
  if (Array.isArray(projectIds) && projectIds.length > 0) {
    const projectSet = new Set(projectIds.filter((id) => typeof id === "string" && id.length > 0));
    if (projectSet.size > 0) {
      result = result.filter((member) => {
        const ids = Array.isArray(member.project_ids) ? member.project_ids : [];
        return ids.some((id) => projectSet.has(id));
      });
    }
  }
  return result;
}

function parseCsvQueryParam(value) {
  if (typeof value !== "string" || !value.trim()) return [];
  return value.split(",").map((part) => part.trim()).filter(Boolean);
}

function mapLegacyMember(doc, profilePhotoUrl = "") {
  const name = resolveMemberDisplayName(doc) || "Unnamed member";
  const avatarUrl =
    profilePhotoUrl ||
    (typeof doc.photo_url === "string" ? doc.photo_url : "") ||
    (typeof doc.photoURL === "string" ? doc.photoURL : "") ||
    (typeof doc.avatar_url === "string" ? doc.avatar_url : "");
  const initials =
    name
      .split(/\s+/)
      .map((p) => p[0])
      .join("")
      .slice(0, 2)
      .toUpperCase() || "??";
  return {
    ...normalizeDoc(doc),
    firebaseUid: typeof doc.firebase_uid === "string" ? doc.firebase_uid : "",
    name,
    email: doc.work_email || doc.personal_email || "",
    personalEmail: typeof doc.personal_email === "string" ? doc.personal_email : "",
    phone:
      (typeof doc.phone_number === "string" ? doc.phone_number : "") ||
      (typeof doc.mobile === "string" ? doc.mobile : "") ||
      (typeof doc.phone === "string" ? doc.phone : ""),
    phoneVerified: doc.phone_verified === true,
    avatarUrl,
    avatar: avatarUrl ? initials : initials,
    avatarColor: typeof doc.avatar_color === "string" ? doc.avatar_color : "#3b82f6",
    lastIp: doc.ip_address || "",
    trackingStatus: effectiveTrackingStatusFromDoc(doc),
    role: "",
    role_name: "",
    role_id: typeof doc.role_id === "string" ? doc.role_id : "",
    payment: doc.pay_rate ? `$${doc.pay_rate}/hr` : "",
    limits:
      doc.weekly_limit == null || doc.weekly_limit === ""
        ? "No limit"
        : typeof doc.weekly_limit === "object"
          ? JSON.stringify(doc.weekly_limit)
          : String(doc.weekly_limit),
    dateAdded: formatDate(doc.date_added),
  };
}

async function mapMembersWithProfilePhotos(db, docs, options = {}) {
  let rows = docs.map((d) => ({ id: d.id, ...d.data() }));
  if (options.needsPresence !== false) {
    const { enrichMembersWithPresenceBatch } = await import("../members/services/member-presence.service.js");
    rows = await enrichMembersWithPresenceBatch(db, rows);
  }
  const photoByUid = new Map();
  if (options.needsPhoto !== false) {
    const uids = [
      ...new Set(
        rows
          .map((r) => (typeof r.firebase_uid === "string" ? r.firebase_uid : ""))
          .filter(Boolean),
      ),
    ];
    if (uids.length > 0) {
      const { USER_PROFILES_COLLECTION } = await import("../auth/profile-collection-name.js");
      const refs = uids.map((uid) => db.collection(USER_PROFILES_COLLECTION).doc(uid));
      const snaps = await db.getAll(...refs);
      for (const snap of snaps) {
        if (!snap.exists) continue;
        const resolved = resolveProfileAvatarUrl(snap.data());
        if (resolved) photoByUid.set(snap.id, resolved);
      }
    }
  }
  return rows.map((row) => {
    const uid = typeof row.firebase_uid === "string" ? row.firebase_uid : "";
    return mapLegacyMember(row, uid ? photoByUid.get(uid) || "" : "");
  });
}

function encodeMemberPageCursor(docId) {
  return Buffer.from(docId, "utf8").toString("base64url");
}

function decodeMemberPageCursor(cursor) {
  if (!cursor || typeof cursor !== "string") return null;
  try {
    const id = Buffer.from(cursor, "base64url").toString("utf8");
    return id || null;
  } catch {
    return null;
  }
}

function memberSortMs(row) {
  const v = row?.date_added ?? row?.dateAdded;
  if (!v) return 0;
  if (typeof v?.toDate === "function") return v.toDate().getTime();
  if (v instanceof Date) return v.getTime();
  const ms = Date.parse(String(v));
  return Number.isFinite(ms) ? ms : 0;
}

export async function routeCompatibility(req, res, url, db, origin) {
  if ((url.pathname === "/api/members/events" || url.pathname === "/api/v1/members/events") && req.method === "GET") {
    const viewer = getAuthContext(req);
    if (!viewer) {
      sendJson(res, origin, 401, { success: false, error: "Authorization required." });
      return true;
    }
    res.writeHead(200, { "Access-Control-Allow-Origin": origin || "*", "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "no-cache, no-transform", Connection: "keep-alive" });

    async function sendMembersFrame() {
      try {
        const visibleIds = await getVisibleMemberIds(db, viewer.memberId, viewer.roleName);
        const { listMembersPg } = await import("../../lib/postgres/members-postgres.service.js");
        let rows = await listMembersPg({ limit: 2000 });
        let docs = rows.map((r) => pgRowToDocShim(r));
        if (visibleIds !== null) {
          const visibleSet = new Set(visibleIds);
          docs = docs.filter((d) => visibleSet.has(d.id));
        }
        let members = await mapMembersWithProfilePhotos(db, docs, { needsPresence: false });
        members = applyMemberFieldPolicy(members, viewer);
        res.write(`data: ${JSON.stringify({ members })}\n\n`);
      } catch (error) {
        res.write(`event: error\ndata: ${JSON.stringify({ message: error instanceof Error ? error.message : "Stream failed" })}\n\n`);
      }
    }

    // Send initial snapshot immediately
    await sendMembersFrame();

    // Re-send on any members change event
    const unsubscribe = subscribeChanges((msg) => {
      if (msg.resource === "members") void sendMembersFrame();
    });
    req.on("close", () => unsubscribe());
    return true;
  }
  if ((url.pathname === "/api/members/batch-delete" || url.pathname === "/api/v1/members/batch-delete") && req.method === "POST") {
    const viewer = getAuthContext(req);
    if (!viewer) {
      sendJson(res, origin, 401, { success: false, error: "Authorization required." });
      return true;
    }
    if (!canUseBatchMemberActions(viewer.roleName)) {
      sendJson(res, origin, 403, { success: false, error: BATCH_MEMBER_ACTIONS_DENIED_MESSAGE });
      return true;
    }
    let body;
    try {
      body = await readCompatBody(req, COMPAT_BODY_SCHEMAS.batchDelete);
    } catch (e) {
      sendJson(res, origin, 400, { success: false, error: e instanceof Error ? e.message : "Invalid body" });
      return true;
    }
    const ids = (Array.isArray(body.ids) ? body.ids : []).filter((id) => typeof id === "string" && id.length > 0);
    if (!ids.length) return sendJson(res, origin, 400, { success: false, error: "body.ids must be a non-empty array" }), true;
    const limitedIds = ids.slice(0, 100);
    for (const id of limitedIds) {
      if (viewer.memberId === id) {
        sendJson(res, origin, 400, {
          success: false,
          error: "You cannot remove yourself from this page. Use Remove Myself in Settings or request deactivation from your Profile.",
        });
        return true;
      }
      const allowed = await canManageMember(db, viewer.memberId, viewer.roleName, id);
      if (!allowed) {
        sendJson(res, origin, 403, { success: false, error: "One or more members are outside your management scope." });
        return true;
      }
    }
    const removeErr = await assertMembersRemovable(db, limitedIds);
    if (removeErr) {
      sendJson(res, origin, 403, { success: false, error: removeErr });
      return true;
    }
    try {
      for (const id of limitedIds) {
        await deleteMemberProfileData(db, id);
        await deleteMemberPg(id, viewer?.memberId);
      }
      sendJson(res, origin, 200, { success: true, data: { deleted: limitedIds.length } });
    } catch (error) {
      sendJson(res, origin, 500, { success: false, error: error instanceof Error ? error.message : "Batch delete failed" });
    }
    return true;
  }
  if ((url.pathname === "/api/members/batch-update" || url.pathname === "/api/v1/members/batch-update") && req.method === "POST") {
    const viewer = getAuthContext(req);
    if (!viewer) {
      sendJson(res, origin, 401, { success: false, error: "Authorization required." });
      return true;
    }
    if (!canUseBatchMemberActions(viewer.roleName)) {
      sendJson(res, origin, 403, { success: false, error: BATCH_MEMBER_ACTIONS_DENIED_MESSAGE });
      return true;
    }
    let body;
    try {
      body = await readCompatBody(req, COMPAT_BODY_SCHEMAS.batchUpdate);
    } catch (e) {
      sendJson(res, origin, 400, { success: false, error: e instanceof Error ? e.message : "Invalid body" });
      return true;
    }
    const ids = (Array.isArray(body.ids) ? body.ids : []).filter((id) => typeof id === "string" && id.length > 0);
    if (!ids.length) return sendJson(res, origin, 400, { success: false, error: "body.ids must be a non-empty array" }), true;
    const payBill = body.payBill && typeof body.payBill === "object" ? body.payBill : null;
    const workLimits = body.workLimits && typeof body.workLimits === "object" ? body.workLimits : null;
    if (!payBill && !workLimits) {
      return sendJson(res, origin, 400, { success: false, error: "Provide payBill and/or workLimits to update." }), true;
    }
    const profilePatch = {
      ...(payBill ? { payBill } : {}),
      ...(workLimits ? { workLimits } : {}),
    };
    const limitedIds = ids.slice(0, 100);
    for (const id of limitedIds) {
      const allowed = await canManageMember(db, viewer.memberId, viewer.roleName, id);
      if (!allowed) {
        sendJson(res, origin, 403, { success: false, error: "One or more members are outside your management scope." });
        return true;
      }
    }
    try {
      const updatedBy = viewer.memberId;
      for (const id of limitedIds) {
        await updateMemberProfile(db, id, profilePatch, updatedBy);
        await upsertMemberFormSnapshot(id, profilePatch, updatedBy);
      }
      sendJson(res, origin, 200, { success: true, data: { updated: limitedIds.length } });
    } catch (error) {
      sendJson(res, origin, 400, { success: false, error: error instanceof Error ? error.message : "Batch update failed" });
    }
    return true;
  }
  const membersRoot = url.pathname === "/api/members" || url.pathname === "/api/v1/members";
  const membersCurrent =
    url.pathname === "/api/members/current" || url.pathname === "/api/v1/members/current";
  if (membersCurrent && req.method === "GET") {
    const authHeader = req.headers.authorization;
    const token = typeof authHeader === "string" && authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
    if (!token) return sendJson(res, origin, 401, { success: false, error: "Not authenticated" }), true;
    const auth = getAuthAdmin();
    if (!auth) return sendJson(res, origin, 503, { success: false, error: "Auth not configured" }), true;
    const decoded = await auth.verifyIdToken(token);
    // Primary lookup: by firebase_uid in Postgres members table (O(1) index)
    let memberRow = await getMemberByFirebaseUidPg(decoded.uid);
    // Email fallback (same two-step the Firestore path used)
    if (!memberRow && typeof decoded.email === "string" && decoded.email) {
      const rows = await query("SELECT * FROM members WHERE work_email = $1 LIMIT 1", [decoded.email.trim().toLowerCase()]);
      memberRow = rows[0] ?? null;
    }
    if (!memberRow) {
      const userRecord = await auth.getUser(decoded.uid);
      await ensureMemberLinkedRecordsForUserRecord(db, userRecord);
      memberRow = await getMemberByFirebaseUidPg(decoded.uid);
      if (!memberRow && typeof decoded.email === "string" && decoded.email) {
        const rows = await query("SELECT * FROM members WHERE work_email = $1 LIMIT 1", [decoded.email.trim().toLowerCase()]);
        memberRow = rows[0] ?? null;
      }
    }
    if (!memberRow) return sendJson(res, origin, 404, { success: false, error: "Member not found" }), true;
    const memberDoc = pgRowToDocShim(memberRow);
    await alignMemberRoleTables(db, memberDoc.id, decoded.uid);
    // Re-fetch after alignment to pick up any role changes
    const refreshedRow = await getMemberByIdPg(memberDoc.id);
    const finalDoc = refreshedRow ? pgRowToDocShim(refreshedRow) : memberDoc;
    const [member] = await mapMembersWithProfilePhotos(db, [finalDoc]);
    let enriched = await enrichMembersWithRoleNames(db, [member]);
    enriched = await enrichMembersWithRelations(db, enriched);
    enriched = await enrichMembersWithPayAndLimits(db, enriched);
    sendJson(res, origin, 200, { success: true, data: enriched[0] });
    return true;
  }
  if (membersRoot && req.method === "GET") {
    try {
      const fieldsParam = url.searchParams.get("fields");
      const fieldsToSelect = fieldsParam
        ? fieldsParam.split(",").map((f) => f.trim()).filter(Boolean)
        : null;

      const needsRoles = !fieldsToSelect || fieldsToSelect.some(f => ["role", "role_name", "role_id", "roleName", "roleId"].includes(f));
      const needsTeams = !fieldsToSelect || fieldsToSelect.some(f => ["teams", "team_names", "teamNames"].includes(f));
      const needsProjects = !fieldsToSelect || fieldsToSelect.some(f => ["projects", "project_ids", "projectIds"].includes(f));
      const needsPresence = !fieldsToSelect || fieldsToSelect.some(f => ["trackingStatus", "tracking_status", "lastPresenceAt", "last_presence_at", "lastIp", "ip_address", "ipAddress"].includes(f));
      const needsPhoto = !fieldsToSelect || fieldsToSelect.some(f => ["avatarUrl", "photo_url", "photoURL", "avatar"].includes(f));

      const paginate = url.searchParams.has("limit") || url.searchParams.has("cursor");
      const pageLimit = paginate
        ? Math.min(Math.max(Number.parseInt(url.searchParams.get("limit") ?? "50", 10) || 50, 1), 200)
        : null;
      const cursorId = paginate ? decodeMemberPageCursor(url.searchParams.get("cursor") ?? "") : null;

      const needsPayOrLimits =
        !fieldsToSelect ||
        fieldsToSelect.some((f) =>
          ["payRate", "pay_rate", "payment", "payPeriod", "pay_period", "weeklyLimit", "weekly_limit", "limits"].includes(f),
        );

      const viewer = getAuthContext(req);
      if (!viewer) {
        sendJson(res, origin, 200, { success: true, data: [], members: [] });
        return true;
      }

      if (isPostgresConfigured()) {
        // Non-management roles (Viewer/Client/Employee) must be scoped to
        // what they're actually allowed to see - listMembersEnrichedPg's own
        // super/management branches already narrow correctly, but its
        // fallback used to return every active member org-wide regardless
        // of viewer role. null here (Owner/Admin/management) is a no-op:
        // those branches ignore visibleIds entirely.
        const visibleIds = await getVisibleMemberIds(db, viewer.memberId, viewer.roleName);
        const enrichedRows = await listMembersEnrichedPg({ viewer, limit: pageLimit ?? 500, visibleIds });
        let members = enrichedRows.map((row) => normalizeDoc(row));
        if (needsPresence) {
          const { enrichMembersWithPresenceBatch } = await import("../members/services/member-presence.service.js");
          members = await enrichMembersWithPresenceBatch(db, members);
        }
        members = applyMemberFieldPolicy(members, viewer);
        const roleFilter = parseCsvQueryParam(url.searchParams.get("roles"));
        const projectFilter = parseCsvQueryParam(url.searchParams.get("project_ids"));
        if (roleFilter.length > 0 || projectFilter.length > 0) {
          members = filterMembersByRoleAndProject(members, roleFilter, projectFilter);
        }
        sendJson(res, origin, 200, { success: true, data: members, members });
        return true;
      }

      const visibleIds = await getVisibleMemberIds(db, viewer.memberId, viewer.roleName);
      const scopedFetch = visibleIds !== null;

      let memberDocSnaps;
      if (scopedFetch) {
        let docs = await fetchMemberDocsByIds(db, visibleIds);
        docs.sort(
          (a, b) =>
            memberSortMs({ date_added: b.data()?.date_added }) -
            memberSortMs({ date_added: a.data()?.date_added }),
        );
        if (paginate) {
          if (cursorId) {
            const cursorIdx = docs.findIndex((doc) => doc.id === cursorId);
            const start = cursorIdx >= 0 ? cursorIdx + 1 : 0;
            docs = docs.slice(start, start + pageLimit + 1);
          } else {
            docs = docs.slice(0, pageLimit + 1);
          }
        }
        memberDocSnaps = docs;
      } else {
        const rows = paginate
          ? await listMembersPagePg({ limit: pageLimit + 1, cursorId })
          : await listMembersPagePg({ limit: 500 });
        memberDocSnaps = rows.map((row) => ({ id: String(row.id), data: () => row }));
      }

      let members = await mapMembersWithProfilePhotos(db, memberDocSnaps, {
        needsPresence,
        needsPhoto,
      });
      const memberIds = members.map((member) => member.id);

      const [relationSnaps, payDocs, limitDocs] = await Promise.all([
        needsTeams || needsProjects ? fetchMemberRelationSnaps(db, memberIds) : Promise.resolve(null),
        needsPayOrLimits ? fetchPayRatesForMembers(db, memberIds) : Promise.resolve(null),
        needsPayOrLimits ? fetchWeeklyLimitsForMembers(db, memberIds) : Promise.resolve(null),
      ]);

      if (needsRoles) {
        members = await enrichMembersWithRoleNames(db, members);
      }
      if ((needsTeams || needsProjects) && relationSnaps) {
        members = enrichMembersWithRelationsFromSnaps(
          members,
          relationSnaps.teamMembersSnap,
          relationSnaps.teamsSnap,
          relationSnaps.projectMembersSnap,
        );
      }
      if (needsPayOrLimits) {
        members = enrichMembersWithPayAndLimitsFromDocs(members, payDocs ?? [], limitDocs ?? []);
      }

      members = applyMemberFieldPolicy(members, viewer);

      const roleFilter = parseCsvQueryParam(url.searchParams.get("roles"));
      const projectFilter = parseCsvQueryParam(url.searchParams.get("project_ids"));
      if (roleFilter.length > 0 || projectFilter.length > 0) {
        members = filterMembersByRoleAndProject(members, roleFilter, projectFilter);
      }
      
      if (!paginate) {
        members.sort((a, b) => memberSortMs(b) - memberSortMs(a));
        const page = scopedFetch ? members : members.slice(0, 200);
        sendJson(res, origin, 200, { success: true, data: page, members: page });
        return true;
      }

      const hasMore = members.length > pageLimit;
      const page = members.slice(0, pageLimit);
      const nextCursor = hasMore && page.length > 0 ? encodeMemberPageCursor(page[page.length - 1].id) : null;
      sendJson(res, origin, 200, {
        success: true,
        data: page,
        members: page,
        nextCursor,
        hasMore,
      });
      return true;
    } catch (err) {
      logSafeWarn("[members] list members error:", err);
      sendJson(res, origin, 500, {
        success: false,
        error: err instanceof Error ? err.message : "Failed to fetch members",
      });
      return true;
    }
  }
  if (membersRoot && req.method === "POST") {
    if (!requireManagementRole(getAuthContext(req))) {
      sendJson(res, origin, 403, { success: false, error: "Insufficient permissions to create members." });
      return true;
    }
    let body;
    try {
      body = await readCompatBody(req, COMPAT_BODY_SCHEMAS.createMember);
    } catch (e) {
      sendJson(res, origin, 400, { success: false, error: e instanceof Error ? e.message : "Invalid body" });
      return true;
    }
    const viewer = getAuthContext(req);
    if (typeof body.role === "string") {
      const roleErr = await validateRoleAssignment(db, viewer?.roleName ?? "", { roleName: body.role });
      if (roleErr) {
        sendJson(res, origin, 403, { success: false, error: roleErr });
        return true;
      }
    }
    const [firstName, ...rest] = (typeof body.name === "string" ? body.name.trim() : "").split(/\s+/).filter(Boolean);
    const payload = {
      id: crypto.randomUUID(),
      first_name: firstName || "Member",
      last_name: rest.join(" "),
      work_email: typeof body.email === "string" ? body.email : "",
      personal_email: "",
      employee_id: "",
      ip_address: typeof body.lastIp === "string" ? body.lastIp : "",
      status: typeof body.status === "string" ? body.status : "active",
      date_added: new Date(),
      created_by: viewer?.memberId ?? "",
      created_by_uid: viewer?.uid ?? "",
      updated_by: "",
      updated_at: new Date(),
    };
    await createMemberPg(payload);
    // publishChange is emitted inside createMemberPg
    const actorId = viewer?.memberId ?? "";
    if (typeof body.role === "string") {
      await syncMemberPrimaryRole(db, payload.id, body.role, actorId, viewer?.roleName ?? "");
    }
    if (typeof body.payRate === "number" && !Number.isNaN(body.payRate)) {
      const { upsertMemberPayRate } = await import("../members/services/member-profile.service.js");
      await upsertMemberPayRate(db, payload.id, body.payRate, actorId, typeof body.currency === "string" ? body.currency : "USD");
    }
    const projectIds = Array.isArray(body.projects) ? body.projects.filter((x) => typeof x === "string") : [];
    if (projectIds.length > 0) {
      await syncProjectMembersForMember(db, payload.id, projectIds, actorId);
    }
    if (viewer?.memberId) {
      try {
        await recordMemberRelationship(db, {
          parentMemberId: viewer.memberId,
          childMemberId: payload.id,
          relationshipType: "admin_create",
          createdBy: viewer.memberId,
          projects: projectIds,
        });
      } catch (e) {
        logSafeWarn("[members] hierarchy edge on create:", e);
      }
    }
    let created = mapLegacyMember({
      ...payload,
      role: typeof body.role === "string" ? body.role : "User",
    });
    [created] = await enrichMembersWithRoleNames(db, [created]);
    [created] = await enrichMembersWithRelations(db, [created]);
    [created] = await enrichMembersWithPayAndLimits(db, [created]);
    sendJson(res, origin, 201, { success: true, data: created });
    return true;
  }
  const membersMatch = parseWithVersion(url.pathname, "members");
  if (membersMatch?.[1] && !membersMatch?.[2] && req.method === "GET") {
    const id = membersMatch[1];
    if (id === "events" || id === "batch-delete" || id === "batch-update") return false;
    if (!(await isMemberVisibleToViewer(req, db, id))) {
      return sendJson(res, origin, 404, { success: false, error: "Not found" }), true;
    }
    const row = await getMemberByIdPg(id);
    if (!row) return sendJson(res, origin, 404, { success: false, error: "Not found" }), true;
    let [mapped] = await mapMembersWithProfilePhotos(db, [pgRowToDocShim(row)]);
    [mapped] = await enrichMembersWithRoleNames(db, [mapped]);
    [mapped] = await enrichMembersWithRelations(db, [mapped]);
    [mapped] = await enrichMembersWithPayAndLimits(db, [mapped]);
    const viewer = getAuthContext(req);
    mapped = applyMemberFieldPolicy([mapped], viewer)[0] ?? mapped;
    sendJson(res, origin, 200, { success: true, data: mapped });
    return true;
  }
  const generateEmployeeIdMatch = /^\/api(?:\/v1)?\/members\/([^/]+)\/generate-employee-id$/.exec(url.pathname);
  if (generateEmployeeIdMatch?.[1] && req.method === "GET") {
    const id = generateEmployeeIdMatch[1];
    const viewer = getAuthContext(req);
    const canManage = requireManagementRole(viewer);
    const editingSelf = viewer?.memberId === id;
    if (!canManage && !editingSelf) {
      sendJson(res, origin, 403, { success: false, error: "Insufficient permissions to generate an employee ID." });
      return true;
    }
    if (!editingSelf && !(await isMemberManageableByViewer(req, db, id))) {
      sendJson(res, origin, 403, { success: false, error: "Insufficient permissions to generate an employee ID." });
      return true;
    }
    if (!(await isMemberVisibleToViewer(req, db, id))) {
      sendJson(res, origin, 404, { success: false, error: "Not found" });
      return true;
    }
    try {
      const firstNameOverride = url.searchParams.get("firstName")?.trim() || undefined;
      const result = await generateMemberEmployeeId(db, id, { firstName: firstNameOverride });
      sendJson(res, origin, 200, { success: true, data: result });
    } catch (error) {
      sendJson(res, origin, 400, {
        success: false,
        error: error instanceof Error ? error.message : "Failed to generate employee ID",
      });
    }
    return true;
  }
  const profileMatch = /^\/api(?:\/v1)?\/members\/([^/]+)\/profile$/.exec(url.pathname);
  const roleMatch = /^\/api(?:\/v1)?\/members\/([^/]+)\/role$/.exec(url.pathname);
  if (roleMatch?.[1] && (req.method === "PATCH" || req.method === "PUT")) {
    const id = roleMatch[1];
    try {
      const viewer = getAuthContext(req);
      if (!requireManagementRole(viewer)) {
        sendJson(res, origin, 403, { success: false, error: "Insufficient permissions to change role." });
        return true;
      }
      if (!(await isMemberManageableByViewer(req, db, id))) {
        sendJson(res, origin, 403, { success: false, error: "Insufficient permissions to change role." });
        return true;
      }
      if (!(await isMemberVisibleToViewer(req, db, id))) {
        sendJson(res, origin, 404, { success: false, error: "Not found" });
        return true;
      }
      let body;
      try {
        body = await readCompatBody(req, COMPAT_BODY_SCHEMAS.patchMemberRole);
      } catch (e) {
        sendJson(res, origin, 400, { success: false, error: e instanceof Error ? e.message : "Invalid body" });
        return true;
      }
      const roleName = typeof body.role === "string" ? body.role.trim() : "";
      if (!roleName) {
        sendJson(res, origin, 400, { success: false, error: "Role is required." });
        return true;
      }
      const roleErr = await validateMemberRoleChange(db, id, roleName, viewer?.roleName ?? "");
      if (roleErr) {
        sendJson(res, origin, 403, { success: false, error: roleErr });
        return true;
      }
      const updatedBy = viewer?.memberId ?? "";
      await timeRoleChangeStep("applyMemberRoleChange", () =>
        applyMemberRoleChange(db, {
          memberId: id,
          roleName,
          actorMemberId: updatedBy,
          actorRoleName: viewer?.roleName ?? "",
        }),
      );
      const [form, member] = await Promise.all([
        getMemberProfileFormSections(db, id, ["roles"]),
        buildRoleChangeMemberResponse(db, id, viewer),
      ]);
      const safeForm = redactProfileFormCompensation(
        { ...form, role: member?.role ?? form.role },
        viewer,
        id,
      );
      // Targeted frame (§4.2): what changed is the affected member's own
      // permissions, which must never be broadcast - sendToMember only
      // reaches their own sockets, not everyone's.
      sendToMember(id, { type: "scope-changed", reason: "role", at: Date.now() });
      sendJson(res, origin, 200, { success: true, data: { form: safeForm, member } });
    } catch (error) {
      sendJson(res, origin, 400, { success: false, error: error instanceof Error ? error.message : "Failed to change role" });
    }
    return true;
  }
  if (profileMatch?.[1] && req.method === "GET") {
    const id = profileMatch[1];
    try {
      if (!(await isMemberVisibleToViewer(req, db, id))) {
        return sendJson(res, origin, 404, { success: false, error: "Not found" }), true;
      }
      const row = await getMemberByIdPg(id);
      if (!row) return sendJson(res, origin, 404, { success: false, error: "Not found" }), true;

      const sectionsParam = url.searchParams.get("sections");
      const requestedSections = sectionsParam
        ? sectionsParam
            .split(",")
            .map((s) => s.trim())
            .filter((s) => MEMBER_PROFILE_SECTIONS.includes(s))
        : null;
      const activeSections =
        requestedSections && requestedSections.length > 0 ? requestedSections : [...MEMBER_PROFILE_SECTIONS];
      const want = (section) => activeSections.includes(section);

      let form = await getMemberProfileFormSections(db, id, activeSections);
      let [member] = await mapMembersWithProfilePhotos(db, [pgRowToDocShim(row)]);
      if (want("roles") || want("payBill") || want("workLimits") || want("settings")) {
        [member] = await enrichMembersWithRoleNames(db, [member]);
      }
      if (want("payBill") || want("workLimits")) {
        [member] = await enrichMembersWithPayAndLimits(db, [member]);
      }
      if (want("roles")) {
        [member] = await enrichMembersWithRelations(db, [member]);
      }
      const viewer = getAuthContext(req);
      member = applyMemberFieldPolicy([member], viewer)[0] ?? member;
      form = redactProfileFormCompensation(form, viewer, id);
      if (member?.role) form = { ...form, role: member.role };
      sendJson(res, origin, 200, {
        success: true,
        data: { form, member, sections: activeSections },
      });
    } catch (error) {
      sendJson(res, origin, 400, { success: false, error: error instanceof Error ? error.message : "Failed to load profile" });
    }
    return true;
  }
  if (profileMatch?.[1] && (req.method === "PATCH" || req.method === "PUT")) {
    const id = profileMatch[1];
    try {
      const viewer = getAuthContext(req);
      const canManage = requireManagementRole(viewer);
      const editingSelf = viewer?.memberId === id;
      if (!canManage && !editingSelf) {
        sendJson(res, origin, 403, { success: false, error: "Insufficient permissions to update this profile." });
        return true;
      }
      if (!editingSelf && !(await isMemberManageableByViewer(req, db, id))) {
        sendJson(res, origin, 403, { success: false, error: "Insufficient permissions to update this profile." });
        return true;
      }
      if (!editingSelf && !(await isMemberVisibleToViewer(req, db, id))) {
        sendJson(res, origin, 404, { success: false, error: "Not found" });
        return true;
      }
      let body;
      try {
        body = await readCompatBody(req, COMPAT_BODY_SCHEMAS.patchProfile);
      } catch (e) {
        sendJson(res, origin, 400, { success: false, error: e instanceof Error ? e.message : "Invalid body" });
        return true;
      }
      if (!canManage && editingSelf) {
        body = { info: body.info && typeof body.info === "object" ? body.info : {} };
      }
      if (!canManage && body.roles && typeof body.roles === "object" && typeof body.roles.role === "string") {
        sendJson(res, origin, 403, { success: false, error: "Insufficient permissions to change role." });
        return true;
      }
      // Pay/bill rate is Super Manager and above only - narrower than
      // canManage (requireManagementRole), which also lets a plain Manager
      // through for every other section. This is a fast-fail mirror of the
      // real enforcement in updateMemberProfile (member-profile.service.js),
      // which is what actually protects every write path, including
      // members/batch-update. Any field in the payload counts, not just
      // payRate - a Manager could otherwise slip currency/payPeriod/note/
      // effectiveDate through unblocked.
      if (
        !isOrgProjectAdminRole(viewer?.roleName ?? "") &&
        body.payBill &&
        typeof body.payBill === "object" &&
        Object.keys(body.payBill).some((k) => k !== "paySegment")
      ) {
        sendJson(res, origin, 403, {
          success: false,
          error: "Only Super Manager and above can edit pay rates.",
        });
        return true;
      }
      if (canManage && body.roles && typeof body.roles === "object" && typeof body.roles.role === "string") {
        const roleErr = await validateMemberRoleChange(db, id, body.roles.role, viewer?.roleName ?? "");
        if (roleErr) {
          sendJson(res, origin, 403, { success: false, error: roleErr });
          return true;
        }
      }
      const updatedBy = viewer?.memberId ?? "";
      const roleName =
        body.roles && typeof body.roles === "object" && typeof body.roles.role === "string"
          ? body.roles.role.trim()
          : "";
      const hasRoleChange = Boolean(roleName && canManage);
      const roleOnly = isRoleOnlyProfilePatch(body);

      if (roleOnly && hasRoleChange) {
        await timeRoleChangeStep("applyMemberRoleChange", () =>
          applyMemberRoleChange(db, {
            memberId: id,
            roleName,
            actorMemberId: updatedBy,
            actorRoleName: viewer?.roleName ?? "",
          }),
        );
        const [form, member] = await Promise.all([
          getMemberProfileFormSections(db, id, ["roles"]),
          buildRoleChangeMemberResponse(db, id, viewer),
        ]);
        const profileViewer = getAuthContext(req);
        const safeForm = redactProfileFormCompensation(
          { ...form, role: member?.role ?? form.role },
          profileViewer,
          id,
        );
        sendJson(res, origin, 200, { success: true, data: { form: safeForm, member } });
        return true;
      }

      const reloadSections = getProfilePatchSections(body);
      const singleSection = reloadSections.length === 1 ? reloadSections[0] : null;
      // §6.9 - optional, only present when the caller sends back the
      // per-section *UpdatedAt it loaded the form with.
      const expectedUpdatedAt = body.expected_updated_at ?? body.expectedUpdatedAt ?? undefined;
      if (
        !hasRoleChange &&
        (singleSection === "payBill" || singleSection === "workLimits" || singleSection === "settings")
      ) {
        let form;
        try {
          form = await updateMemberProfile(db, id, body, updatedBy, {
            actorIsManager: canManage,
            actorUid: viewer?.uid ?? "",
            reloadSections,
            expectedUpdatedAt,
          });
        } catch (e) {
          if (e instanceof Error && e.staleWrite) {
            sendJson(res, origin, 409, { success: false, code: "stale_write", error: e.message });
            return true;
          }
          throw e;
        }
        void upsertMemberFormSnapshot(id, body, updatedBy).catch((e) => {
          logSafeWarn("[members] form snapshot upsert:", e);
        });
        const member = await buildLightSectionMemberResponse(db, id, viewer, singleSection);
        const profileViewer = getAuthContext(req);
        const safeForm = redactProfileFormCompensation({ ...form, role: member?.role ?? form.role }, profileViewer, id);
        sendJson(res, origin, 200, { success: true, data: { form: safeForm, member } });
        return true;
      }

      if (hasRoleChange) {
        await timeRoleChangeStep("applyMemberRoleChange", () =>
          applyMemberRoleChange(db, {
            memberId: id,
            roleName,
            actorMemberId: updatedBy,
            actorRoleName: viewer?.roleName ?? "",
          }),
        );
      }
      let form;
      try {
        form = await updateMemberProfile(db, id, body, updatedBy, {
          actorIsManager: canManage,
          actorUid: viewer?.uid ?? "",
          skipRoleSync: hasRoleChange,
          reloadSections,
          expectedUpdatedAt,
        });
      } catch (e) {
        if (e instanceof Error && e.staleWrite) {
          sendJson(res, origin, 409, { success: false, code: "stale_write", error: e.message });
          return true;
        }
        throw e;
      }
      void upsertMemberFormSnapshot(id, body, updatedBy).catch((e) => {
        logSafeWarn("[members] form snapshot upsert:", e);
      });
      const updatedRow = await getMemberByIdPg(id);
      let [member] = await mapMembersWithProfilePhotos(db, [pgRowToDocShim(updatedRow)]);
      [member] = await enrichMembersWithRoleNames(db, [member]);
      if (!roleOnly && !hasRoleChange) {
        [member] = await enrichMembersWithRelations(db, [member]);
        [member] = await enrichMembersWithPayAndLimits(db, [member]);
      } else if (hasRoleChange && reloadSections.length > 1) {
        const needsRelations = reloadSections.some((s) => s === "roles" || s === "payBill" || s === "workLimits");
        const needsPay = reloadSections.some((s) => s === "payBill" || s === "workLimits");
        if (needsRelations) {
          [member] = await enrichMembersWithRelations(db, [member]);
        }
        if (needsPay) {
          [member] = await enrichMembersWithPayAndLimits(db, [member]);
        }
      }
      const profileViewer = getAuthContext(req);
      member = applyMemberFieldPolicy([member], profileViewer)[0] ?? member;
      const safeForm = redactProfileFormCompensation(
        { ...form, role: member?.role ?? form.role },
        profileViewer,
        id,
      );
      sendJson(res, origin, 200, { success: true, data: { form: safeForm, member } });
    } catch (error) {
      sendJson(res, origin, 400, { success: false, error: error instanceof Error ? error.message : "Failed to save profile" });
    }
    return true;
  }
  if (membersMatch?.[1] && req.method === "DELETE") {
    const id = membersMatch[1];
    if (id === "events" || id === "batch-delete" || id === "batch-update" || id === "current") return false;
    const viewer = getAuthContext(req);
    if (viewer?.memberId === id) {
      sendJson(res, origin, 400, {
        success: false,
        error: "You cannot remove yourself from this page. Use Remove Myself in Settings or request deactivation from your Profile.",
      });
      return true;
    }
    if (!requireManagementRole(viewer)) {
      sendJson(res, origin, 403, { success: false, error: "Insufficient permissions to delete members." });
      return true;
    }
    if (!(await isMemberManageableByViewer(req, db, id))) {
      sendJson(res, origin, 403, { success: false, error: "Insufficient permissions to delete this member." });
      return true;
    }
    if (!(await isMemberVisibleToViewer(req, db, id))) {
      sendJson(res, origin, 404, { success: false, error: "Not found" });
      return true;
    }
    const removeErr = await assertMembersRemovable(db, [id]);
    if (removeErr) {
      sendJson(res, origin, 403, { success: false, error: removeErr });
      return true;
    }
    try {
      await deleteMemberProfileData(db, id);
      await deleteMemberPg(id, viewer?.memberId);
      // publishChange is emitted inside deleteMemberPg
      sendJson(res, origin, 200, { success: true, data: { id, deleted: true } });
    } catch (error) {
      sendJson(res, origin, 500, { success: false, error: error instanceof Error ? error.message : "Delete failed" });
    }
    return true;
  }
  if (membersMatch?.[1] && (req.method === "PUT" || req.method === "PATCH")) {
    const id = membersMatch[1];
    if (id === "events" || id === "batch-delete" || id === "batch-update") return false;
    const viewer = getAuthContext(req);
    const canManage = requireManagementRole(viewer);
    const editingSelf = viewer?.memberId === id;
    if (!canManage && !editingSelf) {
      sendJson(res, origin, 403, { success: false, error: "Insufficient permissions to update this member." });
      return true;
    }
    if (!editingSelf && !(await isMemberManageableByViewer(req, db, id))) {
      sendJson(res, origin, 403, { success: false, error: "Insufficient permissions to update this member." });
      return true;
    }
    if (!editingSelf && !(await isMemberVisibleToViewer(req, db, id))) {
      sendJson(res, origin, 404, { success: false, error: "Not found" });
      return true;
    }
    let body;
    try {
      body = await readCompatBody(req, COMPAT_BODY_SCHEMAS.patchMember);
    } catch (e) {
      sendJson(res, origin, 400, { success: false, error: e instanceof Error ? e.message : "Invalid body" });
      return true;
    }
    if (!canManage && (typeof body.role === "string" || typeof body.payRate === "number")) {
      sendJson(res, origin, 403, { success: false, error: "Insufficient permissions to change role or pay." });
      return true;
    }
    if (typeof body.role === "string") {
      const roleErr = await validateMemberRoleChange(db, id, body.role, viewer?.roleName ?? "");
      if (roleErr) {
        sendJson(res, origin, 403, { success: false, error: roleErr });
        return true;
      }
    }
    const actorId = viewer?.memberId ?? "";
    const updates = {};
    if (typeof body.name === "string") {
      const [firstName, ...rest] = body.name.trim().split(/\s+/).filter(Boolean);
      updates.first_name = firstName || "";
      updates.last_name = rest.join(" ");
    }
    if (typeof body.email === "string") updates.work_email = body.email;
    if (typeof body.status === "string") updates.status = body.status;
    if (typeof body.lastIp === "string") updates.ip_address = body.lastIp;
    updates.updated_by = actorId;
    updates.updated_at = new Date();
    if (Object.keys(updates).length > 1) {
      await updateMemberPg(id, updates);
      // publishChange is emitted inside updateMemberPg
    }
    if (typeof body.role === "string") {
      await timeRoleChangeStep("applyMemberRoleChange", () =>
        applyMemberRoleChange(db, {
          memberId: id,
          roleName: body.role.trim(),
          actorMemberId: actorId,
          actorRoleName: viewer?.roleName ?? "",
        }),
      );
    } else if (
      updates.first_name !== undefined ||
      updates.last_name !== undefined ||
      updates.work_email !== undefined
    ) {
      const { alignMemberRoleTables } = await import("../members/services/relation-sync.js");
      await alignMemberRoleTables(db, id, actorId);
    }
    if (typeof body.payRate === "number") {
      const { upsertMemberPayRate } = await import("../members/services/member-profile.service.js");
      await upsertMemberPayRate(db, id, body.payRate, actorId, typeof body.currency === "string" ? body.currency : "USD");
    }
    if (body.weeklyLimit !== undefined) {
      const { upsertMemberWeeklyLimit } = await import("../members/services/member-profile.service.js");
      await upsertMemberWeeklyLimit(db, id, body.weeklyLimit, actorId);
    }
    if (typeof body.trackingStatus === "string") {
      if (!canManage) {
        sendJson(res, origin, 403, { success: false, error: "Insufficient permissions to change presence status." });
        return true;
      }
      const { patchMemberPresence } = await import("../members/services/member-presence.service.js");
      const normalized = body.trackingStatus.trim().toLowerCase();
      const allowed = new Set(["online", "idle", "offline"]);
      if (!allowed.has(normalized)) {
        sendJson(res, origin, 400, { success: false, error: "trackingStatus must be online, idle, or offline." });
        return true;
      }
      await patchMemberPresence(db, id, { tracking_status: normalized });
    }
    const nextRow = await getMemberByIdPg(id);
    let mapped = mapLegacyMember({ id: String(nextRow?.id ?? id), ...(nextRow ?? {}) });
    [mapped] = await enrichMembersWithRoleNames(db, [mapped]);
    [mapped] = await enrichMembersWithRelations(db, [mapped]);
    [mapped] = await enrichMembersWithPayAndLimits(db, [mapped]);
    const patchViewer = getAuthContext(req);
    mapped = applyMemberFieldPolicy([mapped], patchViewer)[0] ?? mapped;
    // publishChange is emitted inside updateMemberPg (if updates were written)
    void publishChange("members", id, "updated", actorId);
    sendJson(res, origin, 200, { success: true, data: mapped });
    return true;
  }
  const inviteAccept = parseWithVersion(url.pathname, "invites");
  if (inviteAccept?.[1] && inviteAccept?.[2] === "accept" && req.method === "PUT") {
    if (!requireManagementRole(getAuthContext(req))) {
      sendJson(res, origin, 403, { success: false, error: "Insufficient permissions to accept invites." });
      return true;
    }
    const id = inviteAccept[1];
    await query("UPDATE invites SET status = 'accepted', accepted_at = now() WHERE id = $1", [id]);
    const rows = await query("SELECT * FROM invites WHERE id = $1 LIMIT 1", [id]);
    const next = rows[0];
    sendJson(res, origin, 200, { success: true, data: normalizeDoc({ id: String(next?.id ?? id), ...(next ?? {}) }) });
    return true;
  }
  if ((url.pathname === "/api/invites" || url.pathname === "/api/v1/invites") && req.method === "POST") {
    if (!requireManagementRole(getAuthContext(req))) {
      sendJson(res, origin, 403, { success: false, error: "Insufficient permissions to create invites." });
      return true;
    }
    let body;
    try {
      body = await readCompatBody(req, COMPAT_BODY_SCHEMAS.createInvite);
    } catch (e) {
      sendJson(res, origin, 400, { success: false, error: e instanceof Error ? e.message : "Invalid body" });
      return true;
    }
    const viewer = getAuthContext(req);
    if (typeof body.roleId === "string" && body.roleId.trim()) {
      const roleErr = await validateRoleAssignment(db, viewer?.roleName ?? "", { roleId: body.roleId });
      if (roleErr) {
        sendJson(res, origin, 403, { success: false, error: roleErr });
        return true;
      }
    }
    // role_id/created_by/updated_by are real UUID columns - "" fails the
    // ?? null mapping below and Postgres rejects "" as an invalid uuid.
    const payload = { id: crypto.randomUUID(), email: typeof body.email === "string" ? body.email.trim().toLowerCase() : "", invite_token: crypto.randomBytes(24).toString("hex"), invite_kind: "email", role_id: typeof body.roleId === "string" && body.roleId.trim() ? body.roleId : null, pay_rate: typeof body.payRate === "number" ? body.payRate : 0, currency: typeof body.currency === "string" ? body.currency : "USD", status: "pending_signup", sent_at: new Date(), accepted_at: null, created_by: viewer?.memberId || null, created_by_uid: viewer?.uid ?? "", updated_by: null };
    const INVITE_COLS = ["id","email","invite_token","invite_kind","role_id","pay_rate","currency","status","sent_at","accepted_at","created_by","created_by_uid","updated_by"];
    const colList = INVITE_COLS.join(", ");
    const phList = INVITE_COLS.map((_, i) => `$${i + 1}`).join(", ");
    const vals = INVITE_COLS.map((c) => payload[c] instanceof Date ? payload[c] : (payload[c] ?? null));
    await query(`INSERT INTO invites (${colList}) VALUES (${phList})`, vals);
    const inviteBase = resolveAppPublicUrl(typeof body.appOrigin === "string" ? body.appOrigin : "");
    const inviteUrl = `${inviteBase}/invite/${payload.invite_token}`;
    let emailSent = false;
    if (payload.email) {
      let roleName = "Viewer";
      if (typeof body.roleId === "string" && body.roleId.trim()) {
        roleName = (await resolveRoleNameById(db, body.roleId.trim())) || "Viewer";
      }
      const emailResult = await sendMemberInviteEmail({ email: payload.email, inviteUrl, roleName });
      emailSent = emailResult.sent;
    }
    sendJson(res, origin, 201, { success: true, data: normalizeDoc({ ...payload, inviteUrl, emailSent }), emailSent });
    return true;
  }
  if ((url.pathname === "/api/invites/bulk" || url.pathname === "/api/v1/invites/bulk") && req.method === "POST") {
    if (!requireManagementRole(getAuthContext(req))) {
      sendJson(res, origin, 403, { success: false, error: "Insufficient permissions to create invites." });
      return true;
    }
    let body;
    try {
      body = await readCompatBody(req, COMPAT_BODY_SCHEMAS.bulkInvites);
    } catch (e) {
      sendJson(res, origin, 400, { success: false, error: e instanceof Error ? e.message : "Invalid body" });
      return true;
    }
    const viewer = getAuthContext(req);
    const rows = Array.isArray(body.rows) ? body.rows : [];
    for (const row of rows) {
      if (row && typeof row === "object" && !Array.isArray(row)) {
        try {
          rejectUnknownFields(row, COMPAT_BODY_SCHEMAS.bulkInviteRow);
        } catch (e) {
          sendJson(res, origin, 400, { success: false, error: e instanceof Error ? e.message : "Invalid invite row" });
          return true;
        }
      }
    }
    const roleName = typeof body.role === "string" ? body.role.trim() : "User";
    const roleErr = await validateRoleAssignment(db, viewer?.roleName ?? "", { roleName });
    if (roleErr) {
      sendJson(res, origin, 403, { success: false, error: roleErr });
      return true;
    }
    const inviteKind = body.inviteKind === "open_link" ? "open_link" : "email";
    const appOrigin = typeof body.appOrigin === "string" && body.appOrigin.startsWith("http") ? body.appOrigin.replace(/\/$/, "") : "";
    const auth = getAuthAdmin();
    if (inviteKind === "email" && !auth) {
      sendJson(res, origin, 503, { success: false, error: "Cannot verify email availability (Firebase Admin not configured)." });
      return true;
    }
    const seenInRequest = new Set();
    if (inviteKind === "email" && auth) {
      for (const row of rows) {
        const em = typeof row?.email === "string" ? row.email.trim().toLowerCase() : "";
        if (!em) continue;
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(em)) continue;
        if (seenInRequest.has(em)) {
          sendJson(res, origin, 400, { success: false, error: `Duplicate email in this request: ${em}` });
          return true;
        }
        seenInRequest.add(em);
        const check = await assertEmailCanUseMemberInviteOrPreprovision(db, auth, em);
        if (!check.ok) {
          const status = check.reason === "auth_exists" || check.reason === "member_exists" ? 409 : 400;
          sendJson(res, origin, status, {
            success: false,
            error: `${em}: ${check.message}`,
            reason: check.reason,
            email: em,
          });
          return true;
        }
      }
    }
    const inviteBase = resolveAppPublicUrl(appOrigin);
    const created = [];
    let emailsSent = 0;
    let emailsFailed = 0;
    /** @type {string | undefined} */
    let emailChannel;
    for (const row of rows) {
      const email = typeof row?.email === "string" ? row.email.trim().toLowerCase() : "";
      if (inviteKind === "email" && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) continue;
      const token = crypto.randomBytes(24).toString("hex");
      const id = crypto.randomUUID();
      const payRaw = typeof row?.pay_rate === "number" ? row.pay_rate : typeof row?.payRate === "number" ? row.payRate : 0;
      const pay_rate = Number.isFinite(payRaw) ? payRaw : 0;
      const role_id = await resolveRoleIdByName(db, roleName);
      const payload = {
        id,
        email: inviteKind === "email" ? email : "",
        invite_token: token,
        invite_kind: inviteKind,
        role_id,
        pay_rate,
        currency: typeof row?.currency === "string" && row.currency.trim() ? row.currency.trim().toUpperCase() : "USD",
        status: "pending_signup",
        sent_at: new Date(),
        accepted_at: null,
        // created_by/updated_by are real UUID columns - "" (not null/undefined)
        // fails ?? null below and Postgres rejects "" as an invalid uuid.
        created_by: viewer?.memberId || null,
        created_by_uid: viewer?.uid ?? "",
        updated_by: null,
        ...(inviteKind === "open_link" ? shareLinkInviteFields() : {}),
      };
      const bulkCols = ["id","email","invite_token","invite_kind","role_id","pay_rate","currency","status","sent_at","accepted_at","created_by","created_by_uid","updated_by"];
      const bulkColList = bulkCols.join(", ");
      const bulkPhList = bulkCols.map((_, i) => `$${i + 1}`).join(", ");
      const bulkVals = bulkCols.map((c) => payload[c] instanceof Date ? payload[c] : (payload[c] ?? null));
      await query(`INSERT INTO invites (${bulkColList}) VALUES (${bulkPhList})`, bulkVals);
      const invitePath = `/invite/${token}`;
      const inviteUrl = `${inviteBase}${invitePath}`;
      let emailSent = false;
      if (inviteKind === "email" && email) {
        const emailResult = await sendMemberInviteEmail({ email, inviteUrl, roleName });
        emailSent = emailResult.sent;
        if (emailSent) emailsSent += 1;
        else emailsFailed += 1;
        emailChannel = emailResult.channel;
      }
      created.push({ ...normalizeDoc(payload), inviteUrl, emailSent });
      console.info(`[invites/bulk] ${inviteKind} invite ${id} → ${inviteUrl} (emailSent: ${emailSent})`);
    }
    sendJson(res, origin, 201, {
      success: true,
      data: created,
      emailsSent,
      emailsFailed,
      emailChannel: emailChannel ?? "skipped",
      emailDeliveryConfigured: isNotifyEmailRoutingConfigured(),
    });
    return true;
  }
  const memberInvites = parseWithVersion(url.pathname, "member-invites");
  if (memberInvites) {
    const [, id, action] = memberInvites;
    if (!id && req.method === "GET") {
      if (!requireManagementRole(getAuthContext(req))) {
        sendJson(res, origin, 403, { success: false, error: "Insufficient permissions to list invites." });
        return true;
      }
      const viewer = getAuthContext(req);
      const rows = await query("SELECT * FROM invites ORDER BY sent_at DESC LIMIT 200", []);
      let invites = rows.map((d) => normalizeDoc({ id: String(d.id), ...d }));
      if (viewer) {
        const visibleIds = await getVisibleMemberIds(db, viewer.memberId, viewer.roleName);
        if (visibleIds !== null) {
          const viewerUid = typeof viewer.uid === "string" ? viewer.uid : "";
          invites = invites.filter((row) => {
            const createdByUid = typeof row.created_by_uid === "string" ? row.created_by_uid : "";
            return viewerUid && createdByUid === viewerUid;
          });
        }
      }
      invites = invites
        .filter((row) => !shouldHideInviteFromActiveList(row))
        .map((row) => {
          if (typeof row.status === "string" && row.status === "pending_signup" && isInviteExpired(row)) {
            return { ...row, status: "expired" };
          }
          return row;
        });
      sendJson(res, origin, 200, { success: true, data: invites, invites });
      return true;
    }
    if (id && req.method === "DELETE") {
      if (!requireManagementRole(getAuthContext(req))) {
        sendJson(res, origin, 403, { success: false, error: "Insufficient permissions to delete invites." });
        return true;
      }
      const viewer = getAuthContext(req);
      const inviteRows = await query("SELECT * FROM invites WHERE id = $1 LIMIT 1", [id]);
      if (!inviteRows.length) {
        sendJson(res, origin, 404, { success: false, error: "Invite not found." });
        return true;
      }
      const inviteRow = inviteRows[0];
      if (!(await canViewerManageInvite(db, viewer, inviteRow))) {
        sendJson(res, origin, 403, { success: false, error: "Insufficient permissions to delete this invite." });
        return true;
      }
      await query("DELETE FROM invites WHERE id = $1", [id]);
      sendJson(res, origin, 200, { success: true, data: { id, deleted: true } });
      return true;
    }
    if (id && req.method === "PATCH") {
      if (!requireManagementRole(getAuthContext(req))) {
        sendJson(res, origin, 403, { success: false, error: "Insufficient permissions to update invites." });
        return true;
      }
      const inviteRows2 = await query("SELECT * FROM invites WHERE id = $1 LIMIT 1", [id]);
      if (!inviteRows2.length) {
        sendJson(res, origin, 404, { success: false, error: "Invite not found." });
        return true;
      }
      const inviteRow2 = inviteRows2[0];
      const viewer = getAuthContext(req);
      if (!(await canViewerManageInvite(db, viewer, inviteRow2))) {
        sendJson(res, origin, 403, { success: false, error: "Insufficient permissions to update this invite." });
        return true;
      }
      let body;
      try {
        body = await readCompatBody(req, COMPAT_BODY_SCHEMAS.patchInvite);
      } catch (e) {
        sendJson(res, origin, 400, { success: false, error: e instanceof Error ? e.message : "Invalid body" });
        return true;
      }
      if (typeof body.role === "string" && body.role.trim() && !body.role_id) {
        body.role_id = await resolveRoleIdByName(db, body.role.trim());
      }
      if (typeof body.role_id === "string" && body.role_id.trim()) {
        const roleErr = await validateRoleAssignment(db, viewer?.roleName ?? "", { roleId: body.role_id });
        if (roleErr) {
          sendJson(res, origin, 403, { success: false, error: roleErr });
          return true;
        }
      }
      const updates = {};
      if (typeof body.status === "string") updates.status = body.status;
      if (typeof body.pay_rate === "number") updates.pay_rate = body.pay_rate;
      if (typeof body.currency === "string" && body.currency.trim()) updates.currency = body.currency.trim().toUpperCase();
      if (typeof body.role_id === "string") updates.role_id = body.role_id;
      if (Object.keys(updates).length === 0) return sendJson(res, origin, 400, { success: false, error: "No valid fields to update" }), true;
      const setClauses = Object.keys(updates).map((k, i) => `${k} = $${i + 2}`).join(", ");
      await query(`UPDATE invites SET ${setClauses} WHERE id = $1`, [id, ...Object.values(updates)]);
      const nextRows = await query("SELECT * FROM invites WHERE id = $1 LIMIT 1", [id]);
      const nextRow = nextRows[0];
      sendJson(res, origin, 200, { success: true, data: normalizeDoc({ id: String(nextRow?.id ?? id), ...(nextRow ?? {}) }) });
      return true;
    }
    if (id && action === "accept" && req.method === "POST") {
      if (!requireManagementRole(getAuthContext(req))) {
        sendJson(res, origin, 403, { success: false, error: "Insufficient permissions to accept invites." });
        return true;
      }
      await query("UPDATE invites SET status = 'accepted', accepted_at = now() WHERE id = $1", [id]);
      const nextAcceptRows = await query("SELECT * FROM invites WHERE id = $1 LIMIT 1", [id]);
      const nextAccept = nextAcceptRows[0];
      sendJson(res, origin, 200, { success: true, data: normalizeDoc({ id: String(nextAccept?.id ?? id), ...(nextAccept ?? {}) }) });
      return true;
    }
  }
  if (url.pathname === "/api/organization-field-options" || url.pathname === "/api/v1/organization-field-options") {
    const validTypes = ["jobTitle", "department", "jobType", "employmentType", "employedThrough", "workplaceModel", "taxType", "terminationReason", "memberFormSnapshot"];
    if (req.method === "GET") {
      const type = url.searchParams.get("type");
      if (!type || !validTypes.includes(type)) {
        sendJson(res, origin, 400, { success: false, error: "Invalid type" });
        return true;
      }
      const memberDocId = url.searchParams.get("memberDocId");
      if (memberDocId) {
        const viewer = getAuthContext(req);
        if (!viewer) {
          sendJson(res, origin, 401, { success: false, error: "Authorization required." });
          return true;
        }
        const allowed = await canAccessMember(db, viewer.memberId, viewer.roleName, memberDocId);
        if (!allowed) {
          sendJson(res, origin, 404, { success: false, error: "Not found" });
          return true;
        }
      }
      if (type === "memberFormSnapshot") {
        const options = await listMemberFormSnapshotsPg(memberDocId || undefined);
        sendJson(res, origin, 200, { success: true, data: options, options });
        return true;
      }
      // The Firestore branch that used to follow ran only when
      // isPostgresLookupReady() was false, reading members_field_data - a
      // collection that has taken no writes since these options moved to
      // org_field_options. It could not return a current option, only an
      // empty list or a stale one, which is worse than failing.
      const options = await listOrgFieldOptionsPg(type);
      sendJson(res, origin, 200, { success: true, data: options, options });
      return true;
    }
    if (req.method === "POST") {
      let body;
      try {
        body = await readCompatBody(req, COMPAT_BODY_SCHEMAS.orgFieldOption);
      } catch (e) {
        sendJson(res, origin, 400, { success: false, error: e instanceof Error ? e.message : "Invalid body" });
        return true;
      }
      const type = typeof body.type === "string" ? body.type : (typeof body.recordType === "string" ? body.recordType : "");
      if (!validTypes.includes(type)) {
        sendJson(res, origin, 400, { success: false, error: "Invalid type" });
        return true;
      }
      if (type === "memberFormSnapshot") {
        const memberDocId = typeof body.memberDocId === "string" ? body.memberDocId : "";
        if (!memberDocId) {
          sendJson(res, origin, 400, { success: false, error: "memberDocId is required for memberFormSnapshot" });
          return true;
        }
        const viewer = getAuthContext(req);
        const canManage = requireManagementRole(viewer);
        const editingSelf = viewer?.memberId === memberDocId;
        if (!canManage && !editingSelf) {
          sendJson(res, origin, 403, { success: false, error: "Insufficient permissions to save form snapshot." });
          return true;
        }
        const modifiedBy = viewer?.memberId ?? "";
        const formData = body.formData && typeof body.formData === "object" ? body.formData : {};
        const snapshotId = await upsertMemberFormSnapshot(memberDocId, formData, modifiedBy);
        sendJson(res, origin, 200, { success: true, data: { id: snapshotId, memberDocId, type } });
        return true;
      }
      if (!requireManagementRole(getAuthContext(req))) {
        sendJson(res, origin, 403, { success: false, error: "Insufficient permissions to manage organization options." });
        return true;
      }
      const label = typeof body.label === "string" ? body.label : "";
      const position = Number.isInteger(body.position) ? body.position : 0;
      // validTypes and ORG_FIELD_OPTION_TYPES hold the same eight option types
      // (memberFormSnapshot aside, handled above), so this rejects only if the
      // two drift apart later. It used to fall through to a Firestore write
      // into members_field_data instead - a row nothing reads back, since the
      // GET above serves org_field_options.
      if (!ORG_FIELD_OPTION_TYPES.has(type)) {
        sendJson(res, origin, 400, { success: false, error: "Invalid type" });
        return true;
      }
      const created = await createOrgFieldOptionPg({
        type,
        label,
        position,
        modified_by: getAuthContext(req)?.memberId ?? null,
      });
      sendJson(res, origin, 201, { success: true, data: created });
      return true;
    }
  }
  return false;
}
