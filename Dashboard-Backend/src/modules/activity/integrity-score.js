import { isManagementRole } from "../../http/auth-context.js";
import {
  listIntegrityFlagsForSessionPg,
  listIntegrityFlagsForMemberPg,
  getIntegrityFlagByIdPg,
  contestIntegrityFlagPg,
} from "../../lib/postgres/integrity-postgres.service.js";

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
