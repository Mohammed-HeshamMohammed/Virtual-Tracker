import { isManagementRole } from "../../http/auth-context.js";
import {
  listIntegrityFlagsForSessionPg,
  listIntegrityFlagsForMemberPg,
  getIntegrityFlagByIdPg,
  contestIntegrityFlagPg,
} from "../../lib/postgres/integrity-postgres.service.js";

// AC-1/AC-4: how much each contributing factor costs a session's trust, out
// of 100. AC-3's VM detection is deliberately excluded here: it's recorded
// per-device (agent_devices.vm_detected), not per-session (activity_sessions
// carries no device_id to correlate against), and the plan is explicit that
// a VM flag "has real false positives... must be a flag for review weighted
// by context, never an automatic verdict" - it's surfaced next to device
// ownership for a manager to weigh, not folded into this numeric score.
// Every factor here is a persisted, contestable activity_integrity_flags row
// (the sweep job's output) - never a live-computed number the employee has
// no row to push back on.
const FLAG_PENALTIES = {
  injected_input: 40,
  screenshot_staleness: 25,
  category_conflict: 25,
};
const FLAG_LABELS = {
  injected_input: "Most captures showed OS-flagged synthetic input",
  screenshot_staleness: "Screenshots barely changed while activity read high",
  category_conflict: "Sustained distracting-category foreground while activity read high",
};

/**
 * Pure scoring: 100 minus a penalty per contributing flag type, floored at
 * 0. Reframes the gameable "activity %" into "activity % plus how much to
 * trust it" - every subtracted point has a named, visible, contestable
 * reason, never a hidden multiplier.
 * @param {{ flagTypes: string[] }} input
 */
export function computeIntegrityScore({ flagTypes }) {
  const factors = [];
  for (const flagType of new Set(flagTypes)) {
    const penalty = FLAG_PENALTIES[flagType];
    if (!penalty) continue;
    factors.push({ type: flagType, label: FLAG_LABELS[flagType] ?? flagType, penalty });
  }
  const totalPenalty = factors.reduce((sum, f) => sum + f.penalty, 0);
  const score = Math.max(0, Math.min(100, 100 - totalPenalty));
  return { score, factors };
}

/** AC-4: the full per-session integrity summary - score, factors, and the underlying flags to contest. */
export async function getSessionIntegritySummary(sessionId) {
  const flags = await listIntegrityFlagsForSessionPg(sessionId);
  const { score, factors } = computeIntegrityScore({ flagTypes: flags.map((f) => f.flag_type) });
  return {
    sessionId,
    score,
    factors,
    flags: flags.map((f) => ({
      id: f.id,
      flagType: f.flag_type,
      detail: f.detail,
      detectedAt: f.detected_at,
      contested: f.contested,
    })),
  };
}

/**
 * AC-4: "an employee can view ... their own flags" - self always allowed,
 * anyone else only for management, same shape as the rest of this module's
 * self-or-management gates.
 * @param {string} targetMemberId @param {{ memberId: string, roleName: string }} actor
 */
export async function getMemberIntegrityFlags(targetMemberId, actor) {
  if (targetMemberId !== actor?.memberId && !isManagementRole(actor?.roleName)) {
    const err = new Error("Not allowed to view this member's integrity flags.");
    err.code = "FORBIDDEN";
    throw err;
  }
  const rows = await listIntegrityFlagsForMemberPg(targetMemberId);
  return rows.map((f) => ({
    id: f.id,
    sessionId: f.session_id,
    flagType: f.flag_type,
    detail: f.detail,
    detectedAt: f.detected_at,
    contested: f.contested,
    contestedAt: f.contested_at,
    contestedNote: f.contested_note,
  }));
}

/**
 * AC-4: "can ... contest their own flags" - the flagged member or management
 * may attach an explanation; nobody else, and no automated consequence
 * follows from a flag either way (contesting just records a note for a
 * manager to read).
 * @param {string} flagId @param {string} note @param {{ memberId: string, roleName: string }} actor
 */
export async function contestIntegrityFlag(flagId, note, actor) {
  const flag = await getIntegrityFlagByIdPg(flagId);
  if (!flag) {
    const err = new Error("Integrity flag not found.");
    err.code = "NOT_FOUND";
    throw err;
  }
  if (flag.member_id !== actor?.memberId && !isManagementRole(actor?.roleName)) {
    const err = new Error("Not allowed to contest this flag.");
    err.code = "FORBIDDEN";
    throw err;
  }
  const updated = await contestIntegrityFlagPg(flagId, String(note ?? "").slice(0, 2000));
  return updated
    ? {
        id: updated.id,
        sessionId: updated.session_id,
        flagType: updated.flag_type,
        detail: updated.detail,
        detectedAt: updated.detected_at,
        contested: updated.contested,
        contestedAt: updated.contested_at,
        contestedNote: updated.contested_note,
      }
    : null;
}
