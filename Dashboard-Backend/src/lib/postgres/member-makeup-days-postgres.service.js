// Postgres-backed CRUD for member_makeup_days (Work & Limits tab "makeup
// days" calendar). Same delete-then-insert-all-in-one-transaction pattern as
// replaceTeamRosterPg in teams-postgres.service.js - the list is small
// (per-member, per-save), so a full replace is simpler and safe here than a
// true row-level diff.

import crypto from "node:crypto";
import { query, withTransaction } from "./client.js";

function uuidOrNull(value) {
  if (value === null || value === undefined) return null;
  const trimmed = String(value).trim();
  return trimmed ? trimmed : null;
}

/** @param {string} memberId */
export async function listMakeupDaysForMemberPg(memberId) {
  if (!memberId) return [];
  return query(
    "SELECT id, missed_date, makeup_date FROM member_makeup_days WHERE member_id = $1 ORDER BY missed_date",
    [memberId],
  );
}

/**
 * @param {string} memberId
 * @param {{ missedDate: string, makeupDate: string }[]} pairs
 * @param {string} [actorId]
 */
export async function syncMemberMakeupDaysPg(memberId, pairs, actorId) {
  const clean = (Array.isArray(pairs) ? pairs : [])
    .filter(
      (p) =>
        p &&
        typeof p.missedDate === "string" &&
        typeof p.makeupDate === "string" &&
        p.missedDate.length >= 10 &&
        p.makeupDate.length >= 10,
    )
    .map((p) => ({ missedDate: p.missedDate.slice(0, 10), makeupDate: p.makeupDate.slice(0, 10) }));

  return withTransaction(async (client) => {
    await client.query("DELETE FROM member_makeup_days WHERE member_id = $1", [memberId]);
    for (const pair of clean) {
      await client.query(
        `INSERT INTO member_makeup_days (id, member_id, missed_date, makeup_date, created_by)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (member_id, missed_date, makeup_date) DO NOTHING`,
        [crypto.randomUUID(), memberId, pair.missedDate, pair.makeupDate, uuidOrNull(actorId)],
      );
    }
    return clean.length;
  });
}
