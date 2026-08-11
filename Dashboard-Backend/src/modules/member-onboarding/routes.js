import crypto from "node:crypto";
import { getDb } from "../../config/firebase.js";
import { assertManagementRole, assertOrgAdminRole } from "../../http/authorization.js";
import { readJsonBody } from "../../http/read-json-body.js";
import { rejectUnknownFields } from "../../http/validate-body.js";
import { logSafeError } from "../../http/sanitize-error.js";
import { sendJson } from "../../http/response.js";
import { fetchAllDocs } from "../../lib/firestore/paginate-all.js";
import {
  findMemberOnboardingByInviteIdPg,
  findMemberOnboardingByMemberIdPg,
  getMemberOnboardingRowByIdPg,
  listMemberOnboardingRowsPg,
  setMemberOnboardingRowPg,
  updateMemberOnboardingRowPg,
} from "../../lib/postgres/member-data-postgres.service.js";
import { getMemberByIdPg, listMembersPg } from "../../lib/postgres/members-postgres.service.js";
import { query } from "../../lib/postgres/client.js";

function asBool(value, fallback = false) {
  return typeof value === "boolean" ? value : fallback;
}

function toIso(value) {
  if (!value) return null;
  if (typeof value?.toDate === "function") return value.toDate().toISOString();
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "string") {
    const ms = Date.parse(value);
    if (Number.isFinite(ms)) return new Date(ms).toISOString();
  }
  return null;
}

function normalizeOnboardingDoc(id, data) {
  return {
    id,
    memberId: typeof data.member_id === "string" ? data.member_id : null,
    inviteId: typeof data.invite_id === "string" ? data.invite_id : null,
    createdAccount: asBool(data.created_account, false),
    downloadedApp: asBool(data.downloaded_app, false),
    trackedTime: asBool(data.tracked_time, false),
    lastReminderSentAt: toIso(data.last_reminder_sent_at),
    lastReminderSentBy: typeof data.last_reminder_sent_by === "string" ? data.last_reminder_sent_by : "",
    createdAt: toIso(data.created_at),
    updatedAt: toIso(data.updated_at),
  };
}

function computeEmail(item, memberById, inviteById) {
  if (item.memberId && memberById.has(item.memberId)) return memberById.get(item.memberId) || "";
  if (item.inviteId && inviteById.has(item.inviteId)) return inviteById.get(item.inviteId) || "";
  return "";
}

function computeSource(item) {
  if (item.memberId) return "member";
  if (item.inviteId) return "invite";
  return "unknown";
}

function normalizeRole(value) {
  if (typeof value !== "string") return "";
  return value.trim().toLowerCase().replace(/\s+/g, "");
}

function isOwnerRole(value) {
  return normalizeRole(value) === "owner";
}

function buildTimestampsPatch(body) {
  const patch = {};
  if (typeof body.createdAccount === "boolean") {
    patch.created_account = body.createdAccount;
    patch.created_account_at = body.createdAccount ? new Date() : null;
  }
  if (typeof body.downloadedApp === "boolean") {
    patch.downloaded_app = body.downloadedApp;
    patch.downloaded_app_at = body.downloadedApp ? new Date() : null;
  }
  if (typeof body.trackedTime === "boolean") {
    patch.tracked_time = body.trackedTime;
    patch.tracked_time_at = body.trackedTime ? new Date() : null;
  }
  if (typeof body.updatedBy === "string") patch.updated_by = body.updatedBy;
  patch.updated_at = new Date();
  return patch;
}

export async function routeMemberOnboarding(req, res, url, origin) {
  const db = getDb();
  if (!db) return false;
  const pn = url.pathname;

  if ((pn === "/api/member-onboarding" || pn === "/api/v1/member-onboarding") && req.method === "GET") {
    if (!assertManagementRole(req, res, origin)) return true;
    try {
      const [onboardingRows, membersRows, invitesRows] = await Promise.all([
        listMemberOnboardingRowsPg(),
        listMembersPg({ limit: 2000 }),
        query("SELECT * FROM invites ORDER BY sent_at DESC LIMIT 2000", []),
      ]);

      const memberById = new Map();
      const ownerMemberIds = new Set();
      for (const d of membersRows) {
        const id = String(d.id);
        const email = typeof d.work_email === "string" ? d.work_email : typeof d.email === "string" ? d.email : "";
        memberById.set(id, email);
        if (isOwnerRole(d.role)) ownerMemberIds.add(id);
      }

      const inviteById = new Map();
      for (const d of invitesRows) {
        const id = String(d.id);
        const email = typeof d.email === "string" ? d.email : "";
        inviteById.set(id, email);
      }

      const rows = onboardingRows.map((row) => normalizeOnboardingDoc(row.id, row));
      const byMemberId = new Map(rows.filter((r) => r.memberId).map((r) => [r.memberId, r]));
      const byInviteId = new Map(rows.filter((r) => r.inviteId).map((r) => [r.inviteId, r]));

      for (const member of membersRows) {
        const memberId = String(member.id);
        if (ownerMemberIds.has(memberId)) continue;
        if (byMemberId.has(memberId)) continue;
        rows.push({
          id: `member:${memberId}`,
          memberId,
          inviteId: null,
          createdAccount: true,
          downloadedApp: false,
          trackedTime: false,
          lastReminderSentAt: null,
          lastReminderSentBy: "",
          createdAt: null,
          updatedAt: null,
        });
      }

      for (const invite of invitesRows) {
        const inviteId = String(invite.id);
        const status = typeof invite.status === "string" ? invite.status : "";
        if (status === "completed" || status === "accepted") continue;
        if (byInviteId.has(inviteId)) continue;
        rows.push({
          id: `invite:${inviteId}`,
          memberId: null,
          inviteId,
          createdAccount: false,
          downloadedApp: false,
          trackedTime: false,
          lastReminderSentAt: null,
          lastReminderSentBy: "",
          createdAt: null,
          updatedAt: null,
        });
      }

      const withEmail = rows
        .filter((row) => !row.memberId || !ownerMemberIds.has(row.memberId))
        .map((row) => ({
          ...row,
          email: computeEmail(row, memberById, inviteById),
          source: computeSource(row),
        }))
        .filter((row) => row.email);

      sendJson(res, origin, 200, { success: true, data: withEmail });
    } catch (e) {
      logSafeError("[member-onboarding/list]", e);
      sendJson(res, origin, 500, { success: false, error: e instanceof Error ? e.message : "Failed to list onboarding rows" });
    }
    return true;
  }

  const patchMatch = pn.match(/^\/api(?:\/v1)?\/member-onboarding\/([^/]+)$/);
  if (patchMatch && (req.method === "PATCH" || req.method === "PUT")) {
    if (!assertManagementRole(req, res, origin)) return true;
    const id = patchMatch[1];
    let body;
    try {
      body = await readJsonBody(req);
      rejectUnknownFields(body, [
        "createdAccount",
        "downloadedApp",
        "trackedTime",
        "updatedBy",
      ]);
    } catch (e) {
      sendJson(res, origin, 400, { success: false, error: e instanceof Error ? e.message : "Invalid body" });
      return true;
    }

    try {
      const isSyntheticMember = id.startsWith("member:");
      const isSyntheticInvite = id.startsWith("invite:");
      const existing = isSyntheticMember || isSyntheticInvite ? null : await getMemberOnboardingRowByIdPg(id);
      if (!isSyntheticMember && !isSyntheticInvite && !existing) {
        sendJson(res, origin, 404, { success: false, error: "Onboarding row not found" });
        return true;
      }
      const patch = buildTimestampsPatch(body || {});
      let next;
      if (isSyntheticMember) {
        const memberId = id.slice("member:".length);
        if (memberId && (await isOwnerMemberById(memberId))) {
          sendJson(res, origin, 400, { success: false, error: "Owner role is excluded from onboarding." });
          return true;
        }
        next = await setMemberOnboardingRowPg(crypto.randomUUID(), {
          member_id: memberId,
          invite_id: null,
          created_at: new Date(),
          created_by: typeof body.updatedBy === "string" ? body.updatedBy : "system",
          ...patch,
        });
      } else if (isSyntheticInvite) {
        const inviteId = id.slice("invite:".length);
        next = await setMemberOnboardingRowPg(crypto.randomUUID(), {
          member_id: null,
          invite_id: inviteId,
          created_at: new Date(),
          created_by: typeof body.updatedBy === "string" ? body.updatedBy : "system",
          ...patch,
        });
      } else {
        next = await updateMemberOnboardingRowPg(id, patch);
      }
      sendJson(res, origin, 200, { success: true, data: normalizeOnboardingDoc(next.id, next) });
    } catch (e) {
      logSafeError("[member-onboarding/patch]", e);
      sendJson(res, origin, 500, { success: false, error: e instanceof Error ? e.message : "Failed to update onboarding row" });
    }
    return true;
  }

  const remindMatch = pn.match(/^\/api(?:\/v1)?\/member-onboarding\/([^/]+)\/reminder$/);
  if (remindMatch && req.method === "POST") {
    if (!assertManagementRole(req, res, origin)) return true;
    const id = remindMatch[1];
    let body = {};
    try {
      body = await readJsonBody(req);
    } catch {
      // Body is optional for reminders.
    }
    try {
      const isSyntheticMember = id.startsWith("member:");
      const isSyntheticInvite = id.startsWith("invite:");
      const existing = isSyntheticMember || isSyntheticInvite ? null : await getMemberOnboardingRowByIdPg(id);
      if (!isSyntheticMember && !isSyntheticInvite && !existing) {
        sendJson(res, origin, 404, { success: false, error: "Onboarding row not found" });
        return true;
      }
      const updatedBy = typeof body.updatedBy === "string" ? body.updatedBy : "system";
      let next;
      if (isSyntheticMember) {
        const memberId = id.slice("member:".length);
        if (memberId && (await isOwnerMemberById(memberId))) {
          sendJson(res, origin, 400, { success: false, error: "Owner role is excluded from onboarding." });
          return true;
        }
        next = await setMemberOnboardingRowPg(crypto.randomUUID(), {
          member_id: memberId,
          invite_id: null,
          created_account: true,
          downloaded_app: false,
          tracked_time: false,
          created_at: new Date(),
          created_by: updatedBy,
          last_reminder_sent_at: new Date(),
          last_reminder_sent_by: updatedBy,
          updated_by: updatedBy,
        });
      } else if (isSyntheticInvite) {
        const inviteId = id.slice("invite:".length);
        next = await setMemberOnboardingRowPg(crypto.randomUUID(), {
          member_id: null,
          invite_id: inviteId,
          created_account: false,
          downloaded_app: false,
          tracked_time: false,
          created_at: new Date(),
          created_by: updatedBy,
          last_reminder_sent_at: new Date(),
          last_reminder_sent_by: updatedBy,
          updated_by: updatedBy,
        });
      } else {
        next = await updateMemberOnboardingRowPg(id, {
          last_reminder_sent_at: new Date(),
          last_reminder_sent_by: updatedBy,
          updated_by: updatedBy,
        });
      }
      sendJson(res, origin, 200, { success: true, data: normalizeOnboardingDoc(next.id, next) });
    } catch (e) {
      logSafeError("[member-onboarding/reminder]", e);
      sendJson(res, origin, 500, { success: false, error: e instanceof Error ? e.message : "Failed to send reminder" });
    }
    return true;
  }

  if ((pn === "/api/member-onboarding/seed" || pn === "/api/v1/member-onboarding/seed") && req.method === "POST") {
    if (!assertOrgAdminRole(req, res, origin)) return true;
    try {
      const [membersRows, invitesRows] = await Promise.all([
        listMembersPg({ limit: 400 }),
        query("SELECT * FROM invites WHERE status IN ('pending_signup', 'pending') LIMIT 400", []),
      ]);

      const writes = [];
      for (const member of membersRows) {
        const memberId = String(member.id);
        const existing = await findMemberOnboardingByMemberIdPg(memberId);
        if (existing) continue;
        writes.push(
          setMemberOnboardingRowPg(crypto.randomUUID(), {
            member_id: memberId,
            invite_id: null,
            created_account: true,
            created_account_at: new Date(),
            downloaded_app: false,
            downloaded_app_at: null,
            tracked_time: false,
            tracked_time_at: null,
            last_reminder_sent_at: null,
            last_reminder_sent_by: "",
            created_at: new Date(),
            created_by: "seed",
            updated_by: "seed",
          }),
        );
      }

      for (const invite of invitesRows) {
        const inviteId = String(invite.id);
        const existing = await findMemberOnboardingByInviteIdPg(inviteId);
        if (existing) continue;
        writes.push(
          setMemberOnboardingRowPg(crypto.randomUUID(), {
            member_id: null,
            invite_id: inviteId,
            created_account: false,
            created_account_at: null,
            downloaded_app: false,
            downloaded_app_at: null,
            tracked_time: false,
            tracked_time_at: null,
            last_reminder_sent_at: null,
            last_reminder_sent_by: "",
            created_at: new Date(),
            created_by: "seed",
            updated_by: "seed",
          }),
        );
      }

      await Promise.all(writes);
      sendJson(res, origin, 200, { success: true, seeded: writes.length });
    } catch (e) {
      logSafeError("[member-onboarding/seed]", e);
      sendJson(res, origin, 500, { success: false, error: e instanceof Error ? e.message : "Failed to seed onboarding rows" });
    }
    return true;
  }

  return false;
}

/**
 * Defensive check for synthetic member updates/reminders.
 * Fetches one member row by id and verifies owner role exclusion.
 * Keeps owner filtering enforced even when IDs are user-provided.
 * @param {string} memberId
 * @returns {Promise<boolean>}
 */
async function isOwnerMemberById(memberId) {
  if (!memberId) return false;
  const row = await getMemberByIdPg(memberId);
  if (!row) return false;
  return isOwnerRole(row.role);
}
