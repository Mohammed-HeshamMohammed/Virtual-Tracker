import { query } from "../../lib/postgres/client.js";
import { getEnv } from "../../config/env.js";
import { sendEmailViaNotify } from "../../lib/notify/email-client.js";
import { classifyAgentVersion, compareAgentVersions, normalizeAgentVersion } from "./version.js";

const VALID_PLATFORMS = new Set(["windows", "macos", "linux"]);

function toIso(value) {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString();
  const ms = Date.parse(String(value));
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
}

function memberName(row) {
  return row.display_name || [row.first_name, row.last_name].filter(Boolean).join(" ") || row.work_email || "Member";
}

function memberEmail(row) {
  return String(row.work_email || "").trim().toLowerCase();
}

export function normalizeAgentPlatform(value) {
  const platform = typeof value === "string" ? value.trim().toLowerCase() : "";
  return VALID_PLATFORMS.has(platform) ? platform : null;
}

export function supportsAgentInbox(version, latestVersion) {
  const normalizedVersion = normalizeAgentVersion(version);
  const inboxMinVersion = normalizeAgentVersion(getEnv().agent.inboxMinVersion) || latestVersion;
  return Boolean(normalizedVersion && compareAgentVersions(normalizedVersion, inboxMinVersion) >= 0);
}

/**
 * Whether this agent can still update itself.
 *
 * Agents below the threshold are served no update at all (see
 * Landing-Backend's update feed): the copy on the machine is what performs an
 * update, and those copies exit the process before the installer has run, so
 * a failed elevation leaves nothing behind to restart. They are frozen until
 * someone reinstalls them, which is worth showing rather than letting an
 * admin wonder why those machines never move.
 */
export function needsManualReinstall(version) {
  const normalizedVersion = normalizeAgentVersion(version);
  if (!normalizedVersion) return false; // unknown - nothing useful to claim
  const floor = normalizeAgentVersion(getEnv().agent.minSelfUpdateVersion);
  return Boolean(floor && compareAgentVersions(normalizedVersion, floor) < 0);
}

export async function reportAgentOpen(memberId, version, platform) {
  const normalizedVersion = normalizeAgentVersion(version);
  const normalizedPlatform = normalizeAgentPlatform(platform);
  if (!normalizedVersion) return { error: "Tracker version must use major.minor.patch format." };
  if (!normalizedPlatform) return { error: "Tracker platform must be windows, macos, or linux." };
  const rows = await query(
    `UPDATE members
     SET agent_version = $2, agent_platform = $3, agent_last_opened_at = now(), updated_at = now()
     WHERE id = $1
     RETURNING id`,
    [memberId, normalizedVersion, normalizedPlatform],
  );
  return rows.length ? { version: normalizedVersion, platform: normalizedPlatform } : null;
}

export async function listAgentVersionMembers(latestVersion, visibleMemberIds = null) {
  const scoped = Array.isArray(visibleMemberIds);
  const rows = await query(
    `SELECT m.id, m.display_name, m.first_name, m.last_name, m.work_email, m.personal_email,
            m.agent_version, m.agent_platform, m.agent_last_opened_at
     FROM members m
     LEFT JOIN roles r ON r.id = m.role_id
     WHERE m.status != 'banned' AND lower(COALESCE(r.name, '')) != 'owner'
       ${scoped ? "AND m.id = ANY($1::uuid[])" : ""}
     ORDER BY m.agent_last_opened_at DESC NULLS LAST, m.date_added DESC
     LIMIT 2000`,
    scoped ? [visibleMemberIds] : [],
  );
  return rows.map((row) => {
    const version = normalizeAgentVersion(row.agent_version);
    const status = classifyAgentVersion(row.agent_version, latestVersion);
    return {
      memberId: String(row.id),
      displayName: memberName(row),
      email: memberEmail(row),
      agentVersion: version ?? (status === "unrecognized" ? String(row.agent_version) : null),
      agentPlatform: row.agent_platform || null,
      agentLastOpenedAt: toIso(row.agent_last_opened_at),
      status,
      supportsAgentInbox: supportsAgentInbox(version, latestVersion),
      // Frozen: this agent will never be offered an update again.
      needsManualReinstall: needsManualReinstall(row.agent_version),
      canReceiveEmail: Boolean(memberEmail(row)),
    };
  });
}

export function groupAgentVersionMembers(members, latestVersion) {
  const groups = new Map();
  for (const member of members) {
    const key = member.status === "unknown" ? "unknown" : member.status === "unrecognized" ? "unrecognized" : member.agentVersion;
    if (!groups.has(key)) {
      groups.set(key, {
        key,
        version: key === "unknown" || key === "unrecognized" ? null : key,
        status: member.status,
        memberCount: 0,
        members: [],
      });
    }
    const group = groups.get(key);
    group.memberCount += 1;
    group.members.push(member);
  }
  if (!groups.has(latestVersion)) {
    groups.set(latestVersion, { key: latestVersion, version: latestVersion, status: "latest", memberCount: 0, members: [] });
  }
  return [...groups.values()].sort((a, b) => {
    if (!a.version) return b.version ? 1 : a.status.localeCompare(b.status);
    if (!b.version) return -1;
    return -(compareAgentVersions(a.version, b.version) ?? 0);
  });
}

export async function getAgentVersionMember(memberId) {
  const rows = await query(
    `SELECT m.id, m.display_name, m.first_name, m.last_name, m.work_email, m.personal_email,
            m.agent_version, m.agent_platform, m.agent_last_opened_at
     FROM members m
     LEFT JOIN roles r ON r.id = m.role_id
     WHERE m.id = $1 AND m.status != 'banned' AND lower(COALESCE(r.name, '')) != 'owner'
     LIMIT 1`,
    [memberId],
  );
  return rows[0] ?? null;
}

export async function createAgentUpdateNotification(memberId, actorId, currentVersion, targetVersion) {
  const duplicate = await query(
    `SELECT id FROM agent_notifications
     WHERE recipient_id = $1 AND type = 'update_reminder' AND target_version = $2
       AND created_at >= now() - interval '24 hours'
     LIMIT 1`,
    [memberId, targetVersion],
  );
  if (duplicate.length) return { sent: false, duplicate: true };
  await query(
    `INSERT INTO agent_notifications
       (recipient_id, type, title, message, target_version, created_by)
     VALUES ($1, 'update_reminder', 'Tracker update available', $2, $3, $4)`,
    [memberId, `Your tracker ${currentVersion} can be updated to ${targetVersion}.`, targetVersion, actorId || null],
  );
  return { sent: true, duplicate: false };
}

export async function sendAgentUpdateEmail(row, targetVersion, releaseNotes = "") {
  const email = memberEmail(row);
  if (!email) return { sent: false, missingEmail: true };
  return sendEmailViaNotify("agent-update-reminder", {
    email,
    recipientMemberId: String(row.id),
    displayName: memberName(row),
    currentVersion: normalizeAgentVersion(row.agent_version),
    targetVersion,
    releaseNotes,
  });
}

export async function sendAgentInstallEmail(row, targetVersion) {
  const email = memberEmail(row);
  if (!email) return { sent: false, missingEmail: true };
  return sendEmailViaNotify("agent-install-instructions", {
    email,
    recipientMemberId: String(row.id),
    displayName: memberName(row),
    targetVersion,
  });
}

export async function listAgentNotifications(memberId, limit = 20) {
  const safeLimit = Math.min(Math.max(Number(limit) || 20, 1), 50);
  const rows = await query(
    `SELECT id, type, title, message, target_version, thread_id, read_at, created_at
     FROM agent_notifications WHERE recipient_id = $1
     ORDER BY created_at DESC LIMIT $2`,
    [memberId, safeLimit],
  );
  const count = await query(
    `SELECT count(*)::int AS unread FROM agent_notifications WHERE recipient_id = $1 AND read_at IS NULL`,
    [memberId],
  );
  return {
    notifications: rows.map((row) => ({
      id: String(row.id),
      type: row.type,
      title: row.title,
      message: row.message,
      targetVersion: row.target_version || null,
      // Present on an Owner message: what the tracker replies to.
      threadId: row.thread_id ? String(row.thread_id) : null,
      read: Boolean(row.read_at),
      createdAt: toIso(row.created_at),
    })),
    unreadCount: Number(count[0]?.unread ?? 0),
  };
}

export async function markAgentNotificationRead(memberId, notificationId) {
  const rows = await query(
    `UPDATE agent_notifications SET read_at = COALESCE(read_at, now())
     WHERE id = $1 AND recipient_id = $2 RETURNING id`,
    [notificationId, memberId],
  );
  return rows.length > 0;
}

export async function markAllAgentNotificationsRead(memberId) {
  await query(`UPDATE agent_notifications SET read_at = now() WHERE recipient_id = $1 AND read_at IS NULL`, [memberId]);
}
