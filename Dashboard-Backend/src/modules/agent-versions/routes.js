import { assertManagementRole, canManageMember } from "../../http/authorization.js";
import { getDb } from "../../config/firebase.js";
import { getAuthContext, requireAuthContext } from "../../http/auth-context.js";
import { readJsonBody } from "../../http/read-json-body.js";
import { rejectUnknownFields } from "../../http/validate-body.js";
import { sendJson } from "../../http/response.js";
import { logSafeError, logSafeWarn } from "../../http/sanitize-error.js";
import { getLatestAgentRelease } from "./latest-release.js";
import { compareAgentVersions, normalizeAgentVersion } from "./version.js";
import { getVisibleMemberIds } from "../member-relationships/service.js";
import {
  createAgentUpdateNotification,
  getAgentVersionMember,
  groupAgentVersionMembers,
  listAgentNotifications,
  listAgentVersionMembers,
  markAgentNotificationRead,
  markAllAgentNotificationsRead,
  normalizeAgentPlatform,
  reportAgentOpen,
  sendAgentInstallEmail,
  sendAgentUpdateEmail,
  supportsAgentInbox,
} from "./service.js";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function unknownVersion(res, origin) {
  sendJson(res, origin, 409, {
    success: false,
    code: "AGENT_VERSION_UNKNOWN",
    error: "This member has not reported a valid tracker version. Send latest-app install instructions instead.",
  });
}

async function readObject(req) {
  const body = await readJsonBody(req);
  return body && typeof body === "object" && !Array.isArray(body) ? body : {};
}

async function getManagerVisibleMemberIds(req) {
  const viewer = getAuthContext(req);
  return getVisibleMemberIds(getDb(), viewer.memberId, viewer.roleName);
}

async function managerCanTarget(req, memberId) {
  const viewer = getAuthContext(req);
  return canManageMember(getDb(), viewer.memberId, viewer.roleName, memberId);
}

async function deliverUpdate(member, channel, actorId, release) {
  const currentVersion = normalizeAgentVersion(member.agent_version);
  if (!currentVersion) return { status: "unknown" };
  if ((compareAgentVersions(currentVersion, release.version) ?? 0) >= 0) return { status: "current" };
  if (channel === "email") {
    const result = await sendAgentUpdateEmail(member, release.version, release.notes);
    if (result.missingEmail) return { status: "missing-email" };
    return { status: result.sent ? "sent" : result.channel === "skipped" ? "duplicate" : "failed" };
  }
  if (!supportsAgentInbox(currentVersion, release.version)) return { status: "unsupported" };
  const result = await createAgentUpdateNotification(member.id, actorId, currentVersion, release.version);
  return { status: result.sent ? "sent" : "duplicate" };
}

export async function routeAgentVersions(req, res, url, origin) {
  const path = url.pathname.replace(/^\/api\/v1/, "/api");

  if (path === "/api/agent/open" && req.method === "POST") {
    const viewer = requireAuthContext(req, res, origin);
    if (!viewer) return true;
    try {
      const body = await readObject(req);
      rejectUnknownFields(body, ["version", "platform"]);
      if (!normalizeAgentVersion(body.version) || !normalizeAgentPlatform(body.platform)) {
        sendJson(res, origin, 400, { success: false, error: "Valid version and platform are required." });
        return true;
      }
      const result = await reportAgentOpen(viewer.memberId, body.version, body.platform);
      if (!result) {
        sendJson(res, origin, 404, { success: false, error: "Member not found." });
      } else if (result.error) {
        sendJson(res, origin, 400, { success: false, error: result.error });
      } else {
        sendJson(res, origin, 200, { success: true, data: result });
      }
    } catch (error) {
      sendJson(res, origin, 400, { success: false, error: error instanceof Error ? error.message : "Invalid report." });
    }
    return true;
  }

  if (path === "/api/agent-notifications" && req.method === "GET") {
    const viewer = requireAuthContext(req, res, origin);
    if (!viewer) return true;
    try {
      const data = await listAgentNotifications(viewer.memberId, url.searchParams.get("limit"));
      sendJson(res, origin, 200, { success: true, data: data.notifications, unreadCount: data.unreadCount });
    } catch (error) {
      logSafeError("[agent-notifications/list]", error);
      sendJson(res, origin, 500, { success: false, error: "Failed to load tracker notifications." });
    }
    return true;
  }

  if (path === "/api/agent-notifications/read-all" && req.method === "POST") {
    const viewer = requireAuthContext(req, res, origin);
    if (!viewer) return true;
    await markAllAgentNotificationsRead(viewer.memberId);
    sendJson(res, origin, 200, { success: true });
    return true;
  }

  const notificationRead = /^\/api\/agent-notifications\/([^/]+)\/read$/.exec(path);
  if (notificationRead && req.method === "POST") {
    const viewer = requireAuthContext(req, res, origin);
    if (!viewer) return true;
    const id = notificationRead[1];
    const updated = UUID_RE.test(id) && (await markAgentNotificationRead(viewer.memberId, id));
    sendJson(res, origin, updated ? 200 : 404, updated
      ? { success: true }
      : { success: false, error: "Tracker notification not found." });
    return true;
  }

  if (path === "/api/agent-versions" && req.method === "GET") {
    if (!assertManagementRole(req, res, origin)) return true;
    try {
      const release = await getLatestAgentRelease();
      const visibleIds = await getManagerVisibleMemberIds(req);
      const members = await listAgentVersionMembers(release.version, visibleIds);
      const unrecognizedMemberIds = members
        .filter((member) => member.status === "unrecognized")
        .map((member) => member.memberId);
      if (unrecognizedMemberIds.length) {
        logSafeWarn("[agent-versions/unrecognized-reports]", {
          count: unrecognizedMemberIds.length,
          memberIds: unrecognizedMemberIds,
        });
      }
      sendJson(res, origin, 200, {
        success: true,
        latestVersion: release.version,
        groups: groupAgentVersionMembers(members, release.version),
      });
    } catch (error) {
      logSafeError("[agent-versions/list]", error);
      sendJson(res, origin, 503, { success: false, error: "Tracker release information is temporarily unavailable." });
    }
    return true;
  }

  const memberReminder = /^\/api\/members\/([^/]+)\/agent-update-reminders$/.exec(path);
  if (memberReminder && req.method === "POST") {
    if (!assertManagementRole(req, res, origin)) return true;
    try {
      const memberId = memberReminder[1];
      if (!UUID_RE.test(memberId)) {
        sendJson(res, origin, 404, { success: false, error: "Member not found." });
        return true;
      }
      if (!(await managerCanTarget(req, memberId))) {
        sendJson(res, origin, 404, { success: false, error: "Member not found." });
        return true;
      }
      const body = await readObject(req);
      rejectUnknownFields(body, ["channel"]);
      if (body.channel !== "app" && body.channel !== "email") {
        sendJson(res, origin, 400, { success: false, error: "channel must be app or email." });
        return true;
      }
      const [member, release] = await Promise.all([getAgentVersionMember(memberId), getLatestAgentRelease()]);
      if (!member) {
        sendJson(res, origin, 404, { success: false, error: "Member not found." });
        return true;
      }
      if (!normalizeAgentVersion(member.agent_version)) {
        unknownVersion(res, origin);
        return true;
      }
      if ((compareAgentVersions(member.agent_version, release.version) ?? 0) >= 0) {
        sendJson(res, origin, 409, { success: false, code: "AGENT_ALREADY_CURRENT", error: "This member is already using the latest tracker version." });
        return true;
      }
      const result = await deliverUpdate(member, body.channel, getAuthContext(req)?.memberId, release);
      if (result.status === "unsupported") {
        sendJson(res, origin, 409, { success: false, code: "AGENT_INBOX_UNSUPPORTED", error: "This tracker version cannot receive in-app notifications. Send email instead." });
      } else {
        sendJson(res, origin, result.status === "failed" ? 502 : 200, { success: result.status !== "failed", status: result.status });
      }
    } catch (error) {
      logSafeError("[agent-versions/member-reminder]", error);
      sendJson(res, origin, 500, { success: false, error: "Failed to send tracker update reminder." });
    }
    return true;
  }

  const installEmail = /^\/api\/members\/([^/]+)\/agent-install-email$/.exec(path);
  if (installEmail && req.method === "POST") {
    if (!assertManagementRole(req, res, origin)) return true;
    try {
      const memberId = installEmail[1];
      if (!UUID_RE.test(memberId) || !(await managerCanTarget(req, memberId))) {
        sendJson(res, origin, 404, { success: false, error: "Member not found." });
        return true;
      }
      const member = await getAgentVersionMember(memberId);
      if (!member) {
        sendJson(res, origin, 404, { success: false, error: "Member not found." });
        return true;
      }
      if (normalizeAgentVersion(member.agent_version)) {
        sendJson(res, origin, 409, { success: false, code: "AGENT_VERSION_KNOWN", error: "This member has reported a tracker version. Use an update reminder instead." });
        return true;
      }
      if (String(member.agent_version || "").trim()) {
        sendJson(res, origin, 409, { success: false, code: "AGENT_VERSION_UNRECOGNIZED", error: "This member reported an unrecognized tracker version. Ask them to reopen or reinstall the tracker before sending reminders." });
        return true;
      }
      const release = await getLatestAgentRelease();
      const result = await sendAgentInstallEmail(member, release.version);
      sendJson(res, origin, result.sent ? 200 : 409, result.sent
        ? { success: true, status: "sent" }
        : { success: false, code: result.missingEmail ? "MEMBER_EMAIL_MISSING" : "EMAIL_NOT_SENT", error: "Install instructions could not be sent." });
    } catch (error) {
      logSafeError("[agent-versions/install-email]", error);
      sendJson(res, origin, 500, { success: false, error: "Failed to send install instructions." });
    }
    return true;
  }

  if (path === "/api/agent-versions/unknown/install-email" && req.method === "POST") {
    if (!assertManagementRole(req, res, origin)) return true;
    try {
      const release = await getLatestAgentRelease();
      const visibleIds = await getManagerVisibleMemberIds(req);
      const members = await listAgentVersionMembers(release.version, visibleIds);
      const targets = members.filter((member) => member.status === "unknown" && member.canReceiveEmail);
      const summary = { sent: 0, current: 0, duplicate: 0, unsupported: 0, missingEmail: 0, failed: 0 };
      for (let index = 0; index < targets.length; index += 5) {
        const batch = targets.slice(index, index + 5);
        const results = await Promise.all(batch.map(async (item) => {
          const row = await getAgentVersionMember(item.memberId);
          if (!row) return { status: "failed" };
          if (String(row.agent_version || "").trim()) return { status: "current" };
          return sendAgentInstallEmail(row, release.version);
        }));
        for (const result of results) {
          if (result.sent) summary.sent += 1;
          else if (result.status === "current") summary.current += 1;
          else if (result.channel === "skipped") summary.duplicate += 1;
          else if (result.missingEmail) summary.missingEmail += 1;
          else summary.failed += 1;
        }
      }
      sendJson(res, origin, 200, { success: true, summary });
    } catch (error) {
      logSafeError("[agent-versions/bulk-install-email]", error);
      sendJson(res, origin, 500, { success: false, error: "Failed to send bulk install instructions." });
    }
    return true;
  }

  const bulkReminder = /^\/api\/agent-versions\/([^/]+)\/reminders$/.exec(path);
  if (bulkReminder && req.method === "POST") {
    if (!assertManagementRole(req, res, origin)) return true;
    try {
      const requestedVersion = normalizeAgentVersion(decodeURIComponent(bulkReminder[1]));
      if (!requestedVersion) {
        unknownVersion(res, origin);
        return true;
      }
      const body = await readObject(req);
      rejectUnknownFields(body, ["channel"]);
      if (body.channel !== "app" && body.channel !== "email") {
        sendJson(res, origin, 400, { success: false, error: "channel must be app or email." });
        return true;
      }
      const release = await getLatestAgentRelease();
      if ((compareAgentVersions(requestedVersion, release.version) ?? 0) >= 0) {
        sendJson(res, origin, 409, { success: false, code: "AGENT_ALREADY_CURRENT", error: "Update reminders are disabled for the latest tracker version." });
        return true;
      }
      const visibleIds = await getManagerVisibleMemberIds(req);
      const members = await listAgentVersionMembers(release.version, visibleIds);
      const targets = members.filter((member) => member.agentVersion === requestedVersion);
      const summary = { sent: 0, current: 0, duplicate: 0, unsupported: 0, missingEmail: 0, failed: 0 };
      for (let index = 0; index < targets.length; index += 5) {
        const batch = targets.slice(index, index + 5);
        const results = await Promise.all(batch.map(async (item) => {
          const row = await getAgentVersionMember(item.memberId);
          if (!row) return { status: "failed" };
          if (normalizeAgentVersion(row.agent_version) !== requestedVersion) return { status: "current" };
          return deliverUpdate(row, body.channel, getAuthContext(req)?.memberId, release);
        }));
        for (const result of results) {
          if (result.status === "sent") summary.sent += 1;
          else if (result.status === "current") summary.current += 1;
          else if (result.status === "duplicate") summary.duplicate += 1;
          else if (result.status === "unsupported") summary.unsupported += 1;
          else if (result.status === "missing-email") summary.missingEmail += 1;
          else summary.failed += 1;
        }
      }
      sendJson(res, origin, 200, { success: true, summary });
    } catch (error) {
      logSafeError("[agent-versions/bulk-reminder]", error);
      sendJson(res, origin, 500, { success: false, error: "Failed to send bulk tracker reminders." });
    }
    return true;
  }

  return false;
}
