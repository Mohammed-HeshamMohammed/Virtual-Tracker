import crypto from "node:crypto";
import { getPostgresPool, query, withTransaction } from "./client.js";

const MEMBER_SCOPED_COLLECTIONS = new Set(["employment", "time_settings", "pay_rates"]);

function actorIdOrNull(value) {
  if (value === null || value === undefined) return null;
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, 255) : null;
}

function uuidOrNull(value) {
  if (value === null || value === undefined) return null;
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function parseDateOnly(value) {
  if (value == null || value === "") return null;
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  const str = String(value).trim();
  if (!str) return null;
  return str.slice(0, 10);
}

/**
 * @param {Record<string, unknown>} row
 * @returns {Record<string, unknown>}
 */
export function normalizeMemberDataRow(row) {
  const out = { ...row };
  for (const [key, value] of Object.entries(out)) {
    if (value instanceof Date) {
      out[key] = value.toISOString();
    }
    if (key.endsWith("_id") && (value === null || value === undefined)) {
      out[key] = "";
    }
    const camel = key.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
    if (camel !== key) out[camel] = out[key];
  }
  if (out.member_id && !out.id && !out.weekly && !out.daily) {
    out.id = out.member_id;
  }
  return out;
}

// ---------------------------------------------------------------------------
// limits
// ---------------------------------------------------------------------------

/**
 * @param {string} memberId
 */
export async function getLimitsPg(memberId) {
  const rows = await query(
    "SELECT member_id, weekly, daily, updated_by, updated_at FROM limits WHERE member_id = $1 LIMIT 1",
    [memberId],
  );
  if (!rows[0]) return null;
  const row = rows[0];
  return normalizeMemberDataRow({
    id: row.member_id,
    member_id: row.member_id,
    weekly: Number(row.weekly ?? 0),
    daily: Number(row.daily ?? 0),
    updated_by: row.updated_by ?? "",
    updated_at: row.updated_at,
  });
}

/**
 * @param {string[]} memberIds
 */
export async function getLimitsBatchPg(memberIds) {
  const unique = [...new Set(memberIds.filter((id) => typeof id === "string" && id))];
  if (!unique.length) return [];
  const rows = await query(
    "SELECT member_id, weekly, daily, updated_by, updated_at FROM limits WHERE member_id = ANY($1::uuid[])",
    [unique],
  );
  return rows.map((row) =>
    normalizeMemberDataRow({
      id: row.member_id,
      member_id: row.member_id,
      weekly: Number(row.weekly ?? 0),
      daily: Number(row.daily ?? 0),
      updated_by: row.updated_by ?? "",
      updated_at: row.updated_at,
    }),
  );
}

/**
 * @param {string} memberId
 * @param {string} limitType
 * @param {number} value
 * @param {string} updatedBy
 */
export async function upsertLimitFieldPg(memberId, limitType, value, updatedBy) {
  const field = limitType === "daily" ? "daily" : "weekly";
  const actor = actorIdOrNull(updatedBy) ?? "system";
  await query(
    `INSERT INTO limits (member_id, weekly, daily, updated_by, updated_at)
     VALUES ($1, 0, 0, $2, now())
     ON CONFLICT (member_id) DO NOTHING`,
    [memberId, actor],
  );
  await query(`UPDATE limits SET ${field} = $2, updated_by = $3, updated_at = now() WHERE member_id = $1`, [
    memberId,
    value,
    actor,
  ]);
}

/**
 * @param {string} memberId
 * @param {string} actor
 */
export async function ensureLimitsDocPg(memberId, actor) {
  const existing = await getLimitsPg(memberId);
  if (existing) return { created: false, id: memberId };
  const actorId = actorIdOrNull(actor) ?? "system";
  await query(
    `INSERT INTO limits (member_id, weekly, daily, updated_by, updated_at)
     VALUES ($1, 0, 0, $2, now())
     ON CONFLICT (member_id) DO NOTHING`,
    [memberId, actorId],
  );
  return { created: true, id: memberId };
}

/**
 * @param {string} memberId
 */
export async function deleteLimitsDocPg(memberId) {
  await query("DELETE FROM limits WHERE member_id = $1", [memberId]);
}

/**
 * §6.9 follow-up - the workLimits tab spans two tables (`limits`.weekly/daily,
 * `time_settings`.work_days/disable_tracking_specific_days/use_shifts_for_limits)
 * with no single row/timestamp to condition on. Callers pass one composite
 * token (built by member-profile.service.js's buildWorkLimitsToken) split
 * back into the two sides here, and both sides are checked-and-written inside
 * one DB transaction: a stale token on either table rolls back both writes,
 * so the tab never ends up half-saved.
 *
 * Only touches the three time_settings columns workLimits owns - unlike
 * upsertMemberScopedRowPg's full-row overwrite, this never resets the
 * settings tab's able_to_track_time/keep_idle_time/idle_timeout/modify_time/
 * require_approval columns to their defaults.
 *
 * @param {string} memberId
 * @param {{ weekly: number, daily: number, workDays: number[], disableTrackingSpecificDays: boolean, useShiftsForLimits: boolean }} payload
 * @param {string} actor
 * @param {{ limits?: string, timeSettings?: string }} [expected] ISO updated_at
 *   tokens; a missing side is unconditional (first-time create, or no prior
 *   token to compare against).
 * @returns {Promise<{ conflict: boolean }>}
 */
export async function updateWorkLimitsConditionalPg(memberId, payload, actor, expected = {}) {
  const actorId = actorIdOrNull(actor) ?? "system";
  const workDaysJson = JSON.stringify(Array.isArray(payload.workDays) ? payload.workDays : [0, 1, 2, 3, 4]);
  const disableTrackingSpecificDays = payload.disableTrackingSpecificDays === true;
  const useShiftsForLimits = payload.useShiftsForLimits === true;
  const weekly = Number(payload.weekly) || 0;
  const daily = Number(payload.daily) || 0;

  try {
    return await withTransaction(async (client) => {
      const limitsRow = await client.query("SELECT updated_at FROM limits WHERE member_id = $1 FOR UPDATE", [
        memberId,
      ]);
      if (limitsRow.rows.length === 0) {
        await client.query(
          `INSERT INTO limits (member_id, weekly, daily, updated_by, updated_at)
           VALUES ($1, $2, $3, $4, now())`,
          [memberId, weekly, daily, actorId],
        );
      } else {
        if (expected.limits && new Date(limitsRow.rows[0].updated_at).toISOString() !== expected.limits) {
          const conflictErr = new Error("workLimits conflict");
          conflictErr.__workLimitsConflict = true;
          throw conflictErr;
        }
        await client.query(
          `UPDATE limits SET weekly = $2, daily = $3, updated_by = $4, updated_at = now() WHERE member_id = $1`,
          [memberId, weekly, daily, actorId],
        );
      }

      const tsRow = await client.query("SELECT updated_at FROM time_settings WHERE member_id = $1 FOR UPDATE", [
        memberId,
      ]);
      if (tsRow.rows.length === 0) {
        await client.query(
          `INSERT INTO time_settings (
            id, member_id, able_to_track_time, keep_idle_time, idle_timeout, modify_time,
            require_approval, work_days, disable_tracking_specific_days, use_shifts_for_limits,
            updated_by, updated_at
          ) VALUES ($1, $2, true, 'never', '5 min', 'off', false, $3::jsonb, $4, $5, $6, now())`,
          [crypto.randomUUID(), memberId, workDaysJson, disableTrackingSpecificDays, useShiftsForLimits, actorId],
        );
      } else {
        if (
          expected.timeSettings &&
          new Date(tsRow.rows[0].updated_at).toISOString() !== expected.timeSettings
        ) {
          const conflictErr = new Error("workLimits conflict");
          conflictErr.__workLimitsConflict = true;
          throw conflictErr;
        }
        await client.query(
          `UPDATE time_settings
           SET work_days = $2::jsonb, disable_tracking_specific_days = $3, use_shifts_for_limits = $4,
               updated_by = $5, updated_at = now()
           WHERE member_id = $1`,
          [memberId, workDaysJson, disableTrackingSpecificDays, useShiftsForLimits, actorId],
        );
      }

      return { conflict: false };
    });
  } catch (err) {
    if (err && err.__workLimitsConflict) return { conflict: true };
    throw err;
  }
}

// ---------------------------------------------------------------------------
// member-scoped singleton rows (employment, time_settings)
// ---------------------------------------------------------------------------

/**
 * @param {string} collection
 * @param {string} memberId
 */
export async function getMemberScopedRowPg(collection, memberId) {
  if (!MEMBER_SCOPED_COLLECTIONS.has(collection)) return null;
  const rows = await query(`SELECT * FROM ${collection} WHERE member_id = $1 ORDER BY updated_at DESC LIMIT 1`, [
    memberId,
  ]);
  return rows[0] ? normalizeMemberDataRow(rows[0]) : null;
}

/**
 * Batch variant for member-list-enrichment.js's enrichMembersWithPayAndLimits,
 * same shape as getLimitsBatchPg.
 * @param {string[]} memberIds
 */
export async function getPayRatesBatchPg(memberIds) {
  const unique = [...new Set(memberIds.filter((id) => typeof id === "string" && id))];
  if (!unique.length) return [];
  const rows = await query(`SELECT * FROM pay_rates WHERE member_id = ANY($1::uuid[])`, [unique]);
  return rows.map((row) => normalizeMemberDataRow(row));
}

const EMPLOYMENT_UPDATABLE_COLUMNS = [
  "job_title_id",
  "department_id",
  "job_type_id",
  "tax_type_id",
  "work_address",
  "mailing_address",
  "employment_type",
  "employed_through",
  "workplace_model",
  "pct_in_office",
  "pct_remote",
  "tax_info",
  "account_code",
  "currency",
  "start_date",
  "end_date",
  "termination_reason",
  "employment_comments",
];
const TIME_SETTINGS_UPDATABLE_COLUMNS = [
  "able_to_track_time",
  "keep_idle_time",
  "idle_timeout",
  "modify_time",
  "require_approval",
  "work_days",
  "disable_tracking_specific_days",
  "use_shifts_for_limits",
];
const PAY_RATES_UPDATABLE_COLUMNS = [
  "type",
  "rate",
  "currency",
  "pay_period",
  "require_timesheet_approval",
  "effective_date",
  "status",
  "note",
];

function employmentColumnValue(column, payload) {
  switch (column) {
    case "job_title_id":
    case "department_id":
    case "job_type_id":
    case "tax_type_id":
      return uuidOrNull(payload[column]);
    case "mailing_address":
      return payload.mailing_address === true;
    case "pct_in_office":
      return Number(payload.pct_in_office ?? 0);
    case "pct_remote":
      return Number(payload.pct_remote ?? 0);
    case "currency":
      return String(payload.currency ?? "USD");
    case "start_date":
      return parseDateOnly(payload.start_date);
    case "end_date":
      return parseDateOnly(payload.end_date);
    default:
      return String(payload[column] ?? "");
  }
}

function payRatesColumnValue(column, payload) {
  switch (column) {
    case "rate":
      return Number(payload.rate ?? 0);
    case "require_timesheet_approval":
      return payload.require_timesheet_approval === true;
    case "effective_date":
      return parseDateOnly(payload.effective_date);
    case "type":
      return String(payload.type ?? "hourly");
    case "currency":
      return String(payload.currency ?? "USD");
    case "pay_period":
      return String(payload.pay_period ?? "None");
    case "status":
      return String(payload.status ?? "active");
    default:
      return String(payload[column] ?? "");
  }
}

function timeSettingsColumnValue(column, payload) {
  switch (column) {
    case "able_to_track_time":
      return payload.able_to_track_time !== false;
    case "require_approval":
      return payload.require_approval === true;
    case "work_days":
      return JSON.stringify(Array.isArray(payload.work_days) ? payload.work_days : [0, 1, 2, 3, 4]);
    case "disable_tracking_specific_days":
      return payload.disable_tracking_specific_days === true;
    case "use_shifts_for_limits":
      return payload.use_shifts_for_limits === true;
    case "keep_idle_time":
      return String(payload.keep_idle_time ?? "never");
    case "idle_timeout":
      return String(payload.idle_timeout ?? "5 min");
    case "modify_time":
      return String(payload.modify_time ?? "off");
    default:
      return null;
  }
}

const SCOPED_COLUMN_SPECS = {
  employment: { columns: EMPLOYMENT_UPDATABLE_COLUMNS, valueFor: employmentColumnValue },
  time_settings: { columns: TIME_SETTINGS_UPDATABLE_COLUMNS, valueFor: timeSettingsColumnValue },
  pay_rates: { columns: PAY_RATES_UPDATABLE_COLUMNS, valueFor: payRatesColumnValue },
};

/**
 * §6.9 conditional-write path for an existing employment/time_settings/
 * pay_rates row. Same shape as project_budgets' equivalent: a plain
 * `WHERE member_id = $1 AND updated_at = $expected` UPDATE, returning true
 * (conflict) on zero rows.
 * @param {string} collection @param {string} memberId
 * @param {Record<string, unknown>} payload @param {string} actor
 * @param {string} expectedUpdatedAt
 * @returns {Promise<boolean>} true on conflict
 */
async function conditionalUpdateMemberScopedRowPg(collection, memberId, payload, actor, expectedUpdatedAt) {
  const { columns, valueFor } = SCOPED_COLUMN_SPECS[collection];
  const params = [memberId];
  const setClauses = columns.map((column) => {
    params.push(valueFor(column, payload));
    const cast = column === "work_days" ? "::jsonb" : "";
    return `${column} = $${params.length}${cast}`;
  });
  params.push(actor);
  setClauses.push(`updated_by = $${params.length}`);
  params.push(expectedUpdatedAt);
  const rows = await query(
    `UPDATE ${collection} SET ${setClauses.join(", ")}, updated_at = now()
     WHERE member_id = $1 AND updated_at = $${params.length}
     RETURNING member_id`,
    params,
  );
  return rows.length === 0;
}

/**
 * @param {string} collection
 * @param {string} memberId
 * @param {Record<string, unknown>} payload
 * @param {string} [expectedUpdatedAt] §6.9 - only checked when a row already
 *   exists; a first-time create has nothing to conflict with.
 */
export async function upsertMemberScopedRowPg(collection, memberId, payload, expectedUpdatedAt) {
  if (!MEMBER_SCOPED_COLLECTIONS.has(collection)) {
    throw new Error(`Unsupported member-scoped collection: ${collection}`);
  }

  const existing = await getMemberScopedRowPg(collection, memberId);
  const id = existing?.id ?? (typeof payload.id === "string" ? payload.id : crypto.randomUUID());
  const actor = actorIdOrNull(payload.updated_by) ?? "system";

  if (existing && expectedUpdatedAt) {
    const conflict = await conditionalUpdateMemberScopedRowPg(collection, memberId, payload, actor, expectedUpdatedAt);
    if (conflict) return { conflict: true };
    return id;
  }

  if (collection === "employment") {
    await query(
      `INSERT INTO employment (
        id, member_id, job_title_id, department_id, job_type_id, tax_type_id,
        work_address, mailing_address, employment_type, employed_through, workplace_model,
        pct_in_office, pct_remote, tax_info, account_code, currency,
        start_date, end_date, termination_reason, employment_comments,
        created_by, updated_by, created_at, updated_at
      ) VALUES (
        $1, $2, $3, $4, $5, $6,
        $7, $8, $9, $10, $11,
        $12, $13, $14, $15, $16,
        $17, $18, $19, $20,
        $21, $22, COALESCE($23::timestamptz, now()), now()
      )
      ON CONFLICT (member_id) DO UPDATE SET
        job_title_id = EXCLUDED.job_title_id,
        department_id = EXCLUDED.department_id,
        job_type_id = EXCLUDED.job_type_id,
        tax_type_id = EXCLUDED.tax_type_id,
        work_address = EXCLUDED.work_address,
        mailing_address = EXCLUDED.mailing_address,
        employment_type = EXCLUDED.employment_type,
        employed_through = EXCLUDED.employed_through,
        workplace_model = EXCLUDED.workplace_model,
        pct_in_office = EXCLUDED.pct_in_office,
        pct_remote = EXCLUDED.pct_remote,
        tax_info = EXCLUDED.tax_info,
        account_code = EXCLUDED.account_code,
        currency = EXCLUDED.currency,
        start_date = EXCLUDED.start_date,
        end_date = EXCLUDED.end_date,
        termination_reason = EXCLUDED.termination_reason,
        employment_comments = EXCLUDED.employment_comments,
        updated_by = EXCLUDED.updated_by,
        updated_at = now()`,
      [
        id,
        memberId,
        uuidOrNull(payload.job_title_id),
        uuidOrNull(payload.department_id),
        uuidOrNull(payload.job_type_id),
        uuidOrNull(payload.tax_type_id),
        String(payload.work_address ?? ""),
        payload.mailing_address === true,
        String(payload.employment_type ?? ""),
        String(payload.employed_through ?? ""),
        String(payload.workplace_model ?? ""),
        Number(payload.pct_in_office ?? 0),
        Number(payload.pct_remote ?? 0),
        String(payload.tax_info ?? ""),
        String(payload.account_code ?? ""),
        String(payload.currency ?? "USD"),
        parseDateOnly(payload.start_date),
        parseDateOnly(payload.end_date),
        String(payload.termination_reason ?? ""),
        String(payload.employment_comments ?? ""),
        actorIdOrNull(payload.created_by) ?? actor,
        actor,
        payload.created_at ?? null,
      ],
    );
    return id;
  }

  if (collection === "time_settings") {
    const workDays = Array.isArray(payload.work_days) ? payload.work_days : [0, 1, 2, 3, 4];
    await query(
      `INSERT INTO time_settings (
        id, member_id, able_to_track_time, keep_idle_time, idle_timeout, modify_time,
        require_approval, work_days, disable_tracking_specific_days, use_shifts_for_limits,
        updated_by, updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9, $10, $11, now())
      ON CONFLICT (member_id) DO UPDATE SET
        able_to_track_time = EXCLUDED.able_to_track_time,
        keep_idle_time = EXCLUDED.keep_idle_time,
        idle_timeout = EXCLUDED.idle_timeout,
        modify_time = EXCLUDED.modify_time,
        require_approval = EXCLUDED.require_approval,
        work_days = EXCLUDED.work_days,
        disable_tracking_specific_days = EXCLUDED.disable_tracking_specific_days,
        use_shifts_for_limits = EXCLUDED.use_shifts_for_limits,
        updated_by = EXCLUDED.updated_by,
        updated_at = now()`,
      [
        id,
        memberId,
        payload.able_to_track_time !== false,
        String(payload.keep_idle_time ?? "never"),
        String(payload.idle_timeout ?? "5 min"),
        String(payload.modify_time ?? "off"),
        payload.require_approval === true,
        JSON.stringify(workDays),
        payload.disable_tracking_specific_days === true,
        payload.use_shifts_for_limits === true,
        actor,
      ],
    );
    return id;
  }

  // pay_rates
  await query(
    `INSERT INTO pay_rates (
      id, member_id, type, rate, currency, pay_period, require_timesheet_approval,
      effective_date, status, note, created_by, updated_by, created_at, updated_at
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, COALESCE($13::timestamptz, now()), now())
    ON CONFLICT (member_id) DO UPDATE SET
      type = EXCLUDED.type,
      rate = EXCLUDED.rate,
      currency = EXCLUDED.currency,
      pay_period = EXCLUDED.pay_period,
      require_timesheet_approval = EXCLUDED.require_timesheet_approval,
      effective_date = EXCLUDED.effective_date,
      status = EXCLUDED.status,
      note = EXCLUDED.note,
      updated_by = EXCLUDED.updated_by,
      updated_at = now()`,
    [
      id,
      memberId,
      String(payload.type ?? "hourly"),
      Number(payload.rate ?? 0),
      String(payload.currency ?? "USD"),
      String(payload.pay_period ?? "None"),
      payload.require_timesheet_approval === true,
      parseDateOnly(payload.effective_date),
      String(payload.status ?? "active"),
      String(payload.note ?? ""),
      actorIdOrNull(payload.created_by) ?? actor,
      actor,
      payload.created_at ?? null,
    ],
  );
  return id;
}

/**
 * @param {string} collection
 * @param {string} memberId
 * @param {() => Record<string, unknown>} buildPayload
 */
export async function ensureMemberScopedRowPg(collection, memberId, buildPayload) {
  const existing = await getMemberScopedRowPg(collection, memberId);
  if (existing) return { created: false, id: existing.id };
  const id = crypto.randomUUID();
  await upsertMemberScopedRowPg(collection, memberId, { id, member_id: memberId, ...buildPayload() });
  return { created: true, id };
}

/**
 * @param {string} collection
 * @param {string} memberId
 */
export async function deleteMemberScopedRowsPg(collection, memberId) {
  if (!MEMBER_SCOPED_COLLECTIONS.has(collection)) return;
  await query(`DELETE FROM ${collection} WHERE member_id = $1`, [memberId]);
}

/**
 * @param {string} memberId
 */
export async function memberUsesShiftsForLimitsPg(memberId) {
  const row = await getMemberScopedRowPg("time_settings", memberId);
  return row?.use_shifts_for_limits === true;
}

// ---------------------------------------------------------------------------
// member_bans / device_bans
// ---------------------------------------------------------------------------

/**
 * @param {string} emailNorm
 */
export async function findActiveBanByEmailPg(emailNorm) {
  const rows = await query(
    `SELECT * FROM member_bans WHERE email = $1 AND active = true ORDER BY banned_at DESC LIMIT 1`,
    [emailNorm],
  );
  return rows[0] ? normalizeMemberDataRow(rows[0]) : null;
}

/**
 * @param {string} memberId
 */
export async function findActiveBanByMemberIdPg(memberId) {
  const rows = await query(
    `SELECT * FROM member_bans WHERE member_id = $1 AND active = true ORDER BY banned_at DESC LIMIT 1`,
    [memberId],
  );
  return rows[0] ? normalizeMemberDataRow(rows[0]) : null;
}

/**
 * @param {string} firebaseUid
 */
export async function findActiveBanByFirebaseUidPg(firebaseUid) {
  const rows = await query(
    `SELECT * FROM member_bans WHERE firebase_uid = $1 AND active = true ORDER BY banned_at DESC LIMIT 1`,
    [firebaseUid],
  );
  return rows[0] ? normalizeMemberDataRow(rows[0]) : null;
}

export async function listActiveMemberBansPg() {
  const rows = await query(
    `SELECT * FROM member_bans WHERE active = true ORDER BY banned_at DESC LIMIT 500`,
  );
  return rows.map(normalizeMemberDataRow);
}

/**
 * @param {Record<string, unknown>} payload
 */
export async function insertMemberBanPg(payload) {
  const id = typeof payload.id === "string" ? payload.id : crypto.randomUUID();
  await query(
    `INSERT INTO member_bans (
      id, member_id, member_name, email, firebase_uid, reason, ip_address, active,
      banned_at, banned_by_member_id, banned_by_name, email_sent, revoked_at,
      revoked_by_member_id, revoked_by_name
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)`,
    [
      id,
      payload.member_id,
      String(payload.member_name ?? ""),
      String(payload.email ?? ""),
      String(payload.firebase_uid ?? ""),
      String(payload.reason ?? ""),
      String(payload.ip_address ?? ""),
      payload.active !== false,
      payload.banned_at ?? new Date(),
      actorIdOrNull(payload.banned_by_member_id),
      actorIdOrNull(payload.banned_by_name),
      payload.email_sent === true,
      payload.revoked_at ?? null,
      actorIdOrNull(payload.revoked_by_member_id),
      actorIdOrNull(payload.revoked_by_name),
    ],
  );
  return id;
}

/**
 * @param {string} banId
 * @param {Record<string, unknown>} patch
 */
export async function updateMemberBanPg(banId, patch) {
  const fields = [];
  const params = [banId];
  for (const [key, column] of [
    ["active", "active"],
    ["email_sent", "email_sent"],
    ["revoked_at", "revoked_at"],
    ["revoked_by_member_id", "revoked_by_member_id"],
    ["revoked_by_name", "revoked_by_name"],
  ]) {
    if (key in patch) {
      params.push(patch[key]);
      fields.push(`${column} = $${params.length}`);
    }
  }
  if (!fields.length) return;
  await query(`UPDATE member_bans SET ${fields.join(", ")} WHERE id = $1`, params);
}

/**
 * @param {string} banId
 */
export async function getMemberBanPg(banId) {
  const rows = await query("SELECT * FROM member_bans WHERE id = $1 LIMIT 1", [banId]);
  return rows[0] ? normalizeMemberDataRow(rows[0]) : null;
}

/**
 * @param {string} ip
 */
export async function isDevicePermanentlyBannedPg(ip) {
  const rows = await query(
    "SELECT permanently_banned FROM device_bans WHERE ip_address = $1 LIMIT 1",
    [ip],
  );
  return rows[0]?.permanently_banned === true;
}

/**
 * @param {string} ip
 * @param {string} memberId
 */
export async function recordBanIpAndMaybeDeviceBanPg(ip, memberId) {
  const pool = getPostgresPool();
  if (!pool) return;
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const prev = await client.query("SELECT * FROM device_bans WHERE ip_address = $1 FOR UPDATE", [ip]);
    const row = prev.rows[0] || {};
    const banCount = Number(row.ban_count || 0) + 1;
    const memberIds = Array.isArray(row.banned_member_ids) ? [...row.banned_member_ids] : [];
    if (memberId && !memberIds.includes(memberId)) memberIds.push(memberId);
    const permanentlyBanned = banCount >= 2;
    const wasPermanent = row.permanently_banned === true;
    await client.query(
      `INSERT INTO device_bans (ip_address, ban_count, banned_member_ids, permanently_banned, permanently_banned_at, updated_at)
       VALUES ($1, $2, $3::jsonb, $4, $5, now())
       ON CONFLICT (ip_address) DO UPDATE SET
         ban_count = EXCLUDED.ban_count,
         banned_member_ids = EXCLUDED.banned_member_ids,
         permanently_banned = EXCLUDED.permanently_banned,
         permanently_banned_at = CASE
           WHEN EXCLUDED.permanently_banned AND device_bans.permanently_banned_at IS NULL THEN now()
           ELSE device_bans.permanently_banned_at
         END,
         updated_at = now()`,
      [
        ip,
        banCount,
        JSON.stringify(memberIds),
        permanentlyBanned || wasPermanent,
        permanentlyBanned && !wasPermanent ? new Date() : row.permanently_banned_at ?? null,
      ],
    );
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

// ---------------------------------------------------------------------------
// system_meta
// ---------------------------------------------------------------------------

/**
 * @param {string} docKey
 */
export async function getSystemMetaPg(docKey) {
  const rows = await query("SELECT doc_key, payload, updated_at FROM system_meta WHERE doc_key = $1 LIMIT 1", [
    docKey,
  ]);
  if (!rows[0]) return null;
  const payload = rows[0].payload;
  return {
    ...(typeof payload === "object" && payload !== null ? payload : {}),
    updated_at: rows[0].updated_at,
  };
}

/**
 * @param {string} docKey
 * @param {Record<string, unknown>} payload
 */
export async function setSystemMetaPg(docKey, payload) {
  await query(
    `INSERT INTO system_meta (doc_key, payload, updated_at)
     VALUES ($1, $2::jsonb, now())
     ON CONFLICT (doc_key) DO UPDATE SET
       payload = system_meta.payload || EXCLUDED.payload,
       updated_at = now()`,
    [docKey, JSON.stringify(payload)],
  );
}

// ---------------------------------------------------------------------------
// member_tree_cache
// ---------------------------------------------------------------------------

/**
 * @param {string} memberId
 */
export async function getMemberTreeCachePg(memberId) {
  const rows = await query("SELECT * FROM member_tree_cache WHERE member_id = $1 LIMIT 1", [memberId]);
  if (!rows[0]) return null;
  const row = rows[0];
  return normalizeMemberDataRow({
    id: row.member_id,
    ancestors: row.ancestors ?? [],
    descendants: row.descendants ?? [],
    root_id: row.root_id ?? "",
    depth: Number(row.depth ?? 0),
    updated_at: row.updated_at,
  });
}

/**
 * @param {string} memberId
 * @param {Record<string, unknown>} data
 */
export async function setMemberTreeCachePg(memberId, data) {
  await query(
    `INSERT INTO member_tree_cache (member_id, ancestors, descendants, root_id, depth, updated_at)
     VALUES ($1, $2::jsonb, $3::jsonb, $4, $5, now())
     ON CONFLICT (member_id) DO UPDATE SET
       ancestors = EXCLUDED.ancestors,
       descendants = EXCLUDED.descendants,
       root_id = EXCLUDED.root_id,
       depth = EXCLUDED.depth,
       updated_at = now()`,
    [
      memberId,
      JSON.stringify(data.ancestors ?? []),
      JSON.stringify(data.descendants ?? []),
      uuidOrNull(data.root_id),
      Number(data.depth ?? 0),
    ],
  );
}

/**
 * @param {string} memberId
 */
export async function deleteMemberTreeCachePg(memberId) {
  await query("DELETE FROM member_tree_cache WHERE member_id = $1", [memberId]);
}

export async function clearAllMemberTreeCachePg() {
  await query("DELETE FROM member_tree_cache");
}

/**
 * @param {string} oldId
 * @param {string} newId
 */
export async function rekeyMemberDataMemberIdPg(oldId, newId) {
  await query("UPDATE employment SET member_id = $2, updated_at = now() WHERE member_id = $1", [oldId, newId]);
  await query("UPDATE time_settings SET member_id = $2, updated_at = now() WHERE member_id = $1", [oldId, newId]);
  await query("UPDATE pay_rates SET member_id = $2, updated_at = now() WHERE member_id = $1", [oldId, newId]);
  await query("UPDATE limits SET member_id = $2, updated_at = now() WHERE member_id = $1", [oldId, newId]);
  await query("UPDATE member_tree_cache SET member_id = $2, updated_at = now() WHERE member_id = $1", [oldId, newId]);
  await query("UPDATE member_bans SET member_id = $2 WHERE member_id = $1", [oldId, newId]);
  await query("UPDATE member_onboarding SET member_id = $2, updated_at = now() WHERE member_id = $1", [oldId, newId]);
}

export const MEMBER_DATA_POSTGRES_ENTITY_KEYS = new Set([
  "employment",
  "time-settings",
  "pay-rates",
  "limits",
  "member-tree-cache",
  "member-onboarding",
]);

/**
 * @param {string} entityKey
 */
export function isMemberDataPostgresEntityKey(entityKey) {
  return MEMBER_DATA_POSTGRES_ENTITY_KEYS.has(entityKey);
}

/**
 * @param {string} entityKey
 * @param {URL} url
 */
export async function listMemberDataSchemaRows(entityKey, url) {
  if (entityKey === "employment") {
    const conditions = [];
    const params = [];
    const memberId = url.searchParams.get("member_id") ?? url.searchParams.get("memberId");
    if (memberId) {
      params.push(memberId);
      conditions.push(`member_id = $${params.length}`);
    }
    const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
    const rows = await query(`SELECT * FROM employment ${where} ORDER BY updated_at DESC LIMIT 200`, params);
    return rows.map(normalizeMemberDataRow);
  }
  if (entityKey === "time-settings") {
    const conditions = [];
    const params = [];
    const memberId = url.searchParams.get("member_id") ?? url.searchParams.get("memberId");
    if (memberId) {
      params.push(memberId);
      conditions.push(`member_id = $${params.length}`);
    }
    const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
    const rows = await query(`SELECT * FROM time_settings ${where} ORDER BY updated_at DESC LIMIT 200`, params);
    return rows.map(normalizeMemberDataRow);
  }
  if (entityKey === "pay-rates") {
    const conditions = [];
    const params = [];
    const memberId = url.searchParams.get("member_id") ?? url.searchParams.get("memberId");
    if (memberId) {
      params.push(memberId);
      conditions.push(`member_id = $${params.length}`);
    }
    const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
    const rows = await query(`SELECT * FROM pay_rates ${where} ORDER BY updated_at DESC LIMIT 200`, params);
    return rows.map(normalizeMemberDataRow);
  }
  if (entityKey === "limits") {
    const conditions = [];
    const params = [];
    const memberId = url.searchParams.get("member_id") ?? url.searchParams.get("memberId");
    if (memberId) {
      params.push(memberId);
      conditions.push(`member_id = $${params.length}`);
    }
    const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
    const rows = await query(`SELECT member_id, weekly, daily, updated_by, updated_at FROM limits ${where} ORDER BY updated_at DESC LIMIT 200`, params);
    return rows.map((row) =>
      normalizeMemberDataRow({
        id: row.member_id,
        member_id: row.member_id,
        weekly: row.weekly,
        daily: row.daily,
        updated_by: row.updated_by,
        updated_at: row.updated_at,
      }),
    );
  }
  if (entityKey === "member-onboarding") {
    return listMemberOnboardingRowsPg();
  }
  const rows = await query("SELECT * FROM member_tree_cache ORDER BY updated_at DESC LIMIT 200");
  return rows.map((row) =>
    normalizeMemberDataRow({
      id: row.member_id,
      member_id: row.member_id,
      ancestors: row.ancestors ?? [],
      descendants: row.descendants ?? [],
      root_id: row.root_id ?? "",
      depth: row.depth ?? 0,
      updated_at: row.updated_at,
    }),
  );
}

/**
 * @param {string} entityKey
 * @param {string} id
 */
export async function getMemberDataSchemaRow(entityKey, id) {
  if (entityKey === "limits") return getLimitsPg(id);
  if (entityKey === "member-tree-cache") return getMemberTreeCachePg(id);
  if (entityKey === "member-onboarding") return getMemberOnboardingRowByIdPg(id);
  const table = entityKey === "employment" ? "employment" : entityKey === "pay-rates" ? "pay_rates" : "time_settings";
  const rows = await query(`SELECT * FROM ${table} WHERE id = $1 LIMIT 1`, [id]);
  return rows[0] ? normalizeMemberDataRow(rows[0]) : null;
}

/**
 * @param {string} entityKey
 * @param {Record<string, unknown>} payload
 */
export async function createMemberDataSchemaRow(entityKey, payload) {
  if (entityKey === "limits") {
    const memberId = String(payload.member_id ?? payload.id ?? "");
    await query(
      `INSERT INTO limits (member_id, weekly, daily, updated_by, updated_at)
       VALUES ($1, $2, $3, $4, now())`,
      [memberId, Number(payload.weekly ?? 0), Number(payload.daily ?? 0), actorIdOrNull(payload.updated_by)],
    );
    return getLimitsPg(memberId);
  }
  if (entityKey === "member-tree-cache") {
    const memberId = String(payload.member_id ?? payload.id ?? "");
    await setMemberTreeCachePg(memberId, payload);
    return getMemberTreeCachePg(memberId);
  }
  if (entityKey === "member-onboarding") {
    return createMemberOnboardingRowPg(payload);
  }
  const collection = entityKey === "employment" ? "employment" : entityKey === "pay-rates" ? "pay_rates" : "time_settings";
  const memberId = String(payload.member_id ?? "");
  const id = typeof payload.id === "string" ? payload.id : crypto.randomUUID();
  await upsertMemberScopedRowPg(collection, memberId, { ...payload, id, member_id: memberId });
  return getMemberScopedRowPg(collection, memberId);
}

/**
 * @param {string} entityKey
 * @param {string} id
 * @param {Record<string, unknown>} payload
 * @param {Record<string, unknown>} existing
 */
export async function updateMemberDataSchemaRow(entityKey, id, payload, existing) {
  if (entityKey === "limits") {
    const memberId = String(existing.member_id ?? existing.id ?? id);
    if (payload.weekly !== undefined) await upsertLimitFieldPg(memberId, "weekly", Number(payload.weekly), String(payload.updated_by ?? existing.updated_by ?? "system"));
    if (payload.daily !== undefined) await upsertLimitFieldPg(memberId, "daily", Number(payload.daily), String(payload.updated_by ?? existing.updated_by ?? "system"));
    if (payload.updated_by !== undefined && payload.weekly === undefined && payload.daily === undefined) {
      await query("UPDATE limits SET updated_by = $2, updated_at = now() WHERE member_id = $1", [memberId, actorIdOrNull(payload.updated_by)]);
    }
    return getLimitsPg(memberId);
  }
  if (entityKey === "member-tree-cache") {
    const memberId = String(existing.member_id ?? existing.id ?? id);
    await setMemberTreeCachePg(memberId, { ...existing, ...payload, id: memberId });
    return getMemberTreeCachePg(memberId);
  }
  if (entityKey === "member-onboarding") {
    return updateMemberOnboardingRowPg(id, payload);
  }
  const collection = entityKey === "employment" ? "employment" : entityKey === "pay-rates" ? "pay_rates" : "time_settings";
  const memberId = String(existing.member_id ?? payload.member_id ?? "");
  await upsertMemberScopedRowPg(collection, memberId, { ...existing, ...payload, id, member_id: memberId });
  return getMemberScopedRowPg(collection, memberId);
}

/**
 * @param {string} entityKey
 * @param {string} id
 */
export async function deleteMemberDataSchemaRow(entityKey, id) {
  if (entityKey === "limits") {
    await deleteLimitsDocPg(id);
    return;
  }
  if (entityKey === "member-tree-cache") {
    await deleteMemberTreeCachePg(id);
    return;
  }
  if (entityKey === "member-onboarding") {
    await query("DELETE FROM member_onboarding WHERE id = $1", [id]);
    return;
  }
  const table = entityKey === "employment" ? "employment" : entityKey === "pay-rates" ? "pay_rates" : "time_settings";
  await query(`DELETE FROM ${table} WHERE id = $1`, [id]);
}

// ---------------------------------------------------------------------------
// member_onboarding
// ---------------------------------------------------------------------------

const MEMBER_ONBOARDING_COLUMNS = [
  "id",
  "member_id",
  "invite_id",
  "created_account",
  "created_account_at",
  "downloaded_app",
  "downloaded_app_at",
  "tracked_time",
  "tracked_time_at",
  "last_reminder_sent_at",
  "last_reminder_sent_by",
  "created_at",
  "created_by",
  "updated_by",
  "updated_at",
];

/** @param {Record<string, unknown>} row */
function normalizeOnboardingRowPg(row) {
  return normalizeMemberDataRow(row);
}

export async function listMemberOnboardingRowsPg() {
  const rows = await query(
    `SELECT * FROM member_onboarding ORDER BY updated_at DESC NULLS LAST, created_at DESC LIMIT 2000`,
  );
  return rows.map(normalizeOnboardingRowPg);
}

/** @param {string} id */
export async function getMemberOnboardingRowByIdPg(id) {
  const rows = await query("SELECT * FROM member_onboarding WHERE id = $1 LIMIT 1", [id]);
  return rows[0] ? normalizeOnboardingRowPg(rows[0]) : null;
}

/** @param {string} memberId */
export async function findMemberOnboardingByMemberIdPg(memberId) {
  const rows = await query("SELECT * FROM member_onboarding WHERE member_id = $1 LIMIT 1", [memberId]);
  return rows[0] ? normalizeOnboardingRowPg(rows[0]) : null;
}

/** @param {string} inviteId */
export async function findMemberOnboardingByInviteIdPg(inviteId) {
  const rows = await query("SELECT * FROM member_onboarding WHERE invite_id = $1 LIMIT 1", [inviteId]);
  return rows[0] ? normalizeOnboardingRowPg(rows[0]) : null;
}

/**
 * Full overwrite (INSERT .. ON CONFLICT (id) DO UPDATE SET everything),
 * matching the Firestore `.set()` calls this replaces in
 * member-onboarding/routes.js - not a partial merge.
 * @param {string} id @param {Record<string, unknown>} data
 */
export async function setMemberOnboardingRowPg(id, data) {
  await query(
    `INSERT INTO member_onboarding (
      id, member_id, invite_id, created_account, created_account_at,
      downloaded_app, downloaded_app_at, tracked_time, tracked_time_at,
      last_reminder_sent_at, last_reminder_sent_by, created_at, created_by, updated_by, updated_at
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,COALESCE($12::timestamptz, now()),$13,$14,now())
    ON CONFLICT (id) DO UPDATE SET
      member_id = EXCLUDED.member_id,
      invite_id = EXCLUDED.invite_id,
      created_account = EXCLUDED.created_account,
      created_account_at = EXCLUDED.created_account_at,
      downloaded_app = EXCLUDED.downloaded_app,
      downloaded_app_at = EXCLUDED.downloaded_app_at,
      tracked_time = EXCLUDED.tracked_time,
      tracked_time_at = EXCLUDED.tracked_time_at,
      last_reminder_sent_at = EXCLUDED.last_reminder_sent_at,
      last_reminder_sent_by = EXCLUDED.last_reminder_sent_by,
      created_by = EXCLUDED.created_by,
      updated_by = EXCLUDED.updated_by,
      updated_at = now()`,
    [
      id,
      uuidOrNull(data.member_id),
      uuidOrNull(data.invite_id),
      data.created_account === true,
      data.created_account_at ?? null,
      data.downloaded_app === true,
      data.downloaded_app_at ?? null,
      data.tracked_time === true,
      data.tracked_time_at ?? null,
      data.last_reminder_sent_at ?? null,
      String(data.last_reminder_sent_by ?? ""),
      data.created_at ?? null,
      actorIdOrNull(data.created_by),
      actorIdOrNull(data.updated_by),
    ],
  );
  return getMemberOnboardingRowByIdPg(id);
}

/**
 * Partial update, matching the Firestore `.update()` calls this replaces.
 * @param {string} id @param {Record<string, unknown>} patch
 */
export async function updateMemberOnboardingRowPg(id, patch) {
  const columns = MEMBER_ONBOARDING_COLUMNS.filter((c) => c !== "id" && patch[c] !== undefined);
  if (!columns.length) return getMemberOnboardingRowByIdPg(id);
  const params = [id];
  const setClauses = columns.map((column) => {
    const value =
      column === "member_id" || column === "invite_id"
        ? uuidOrNull(patch[column])
        : column === "created_account" || column === "downloaded_app" || column === "tracked_time"
          ? patch[column] === true
          : column === "created_by" || column === "updated_by"
            ? actorIdOrNull(patch[column])
            : patch[column];
    params.push(value);
    return `${column} = $${params.length}`;
  });
  setClauses.push("updated_at = now()");
  await query(`UPDATE member_onboarding SET ${setClauses.join(", ")} WHERE id = $1`, params);
  return getMemberOnboardingRowByIdPg(id);
}

/** Cascade-delete cleanup counterpart to deleteMemberScopedRowsPg. @param {string} memberId */
export async function deleteMemberOnboardingByMemberIdPg(memberId) {
  await query("DELETE FROM member_onboarding WHERE member_id = $1", [memberId]);
}

/** @param {Record<string, unknown>} payload */
export async function createMemberOnboardingRowPg(payload) {
  const id = typeof payload.id === "string" && payload.id ? payload.id : crypto.randomUUID();
  return setMemberOnboardingRowPg(id, { ...payload, id });
}

/**
 * member_onboarding has no unique constraint on member_id (a row can also
 * key off invite_id alone with member_id null) - dedupe the same way the
 * Firestore version did: keep the most-recently-updated row per member_id,
 * delete the rest.
 * @param {string} memberId
 * @returns {Promise<number>} rows removed
 */
export async function dedupeMemberOnboardingByMemberIdPg(memberId) {
  const rows = await query(
    "SELECT id FROM member_onboarding WHERE member_id = $1 ORDER BY updated_at DESC NULLS LAST, created_at DESC",
    [memberId],
  );
  if (rows.length <= 1) return 0;
  const staleIds = rows.slice(1).map((r) => r.id);
  await query("DELETE FROM member_onboarding WHERE id = ANY($1::uuid[])", [staleIds]);
  return staleIds.length;
}
