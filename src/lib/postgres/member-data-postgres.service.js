import crypto from "node:crypto";
import { getPostgresPool, query } from "./client.js";

const MEMBER_SCOPED_COLLECTIONS = new Set(["employment", "time_settings"]);

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
 * @param {string} collection
 * @param {string} memberId
 * @param {Record<string, unknown>} payload
 */
export async function upsertMemberScopedRowPg(collection, memberId, payload) {
  if (!MEMBER_SCOPED_COLLECTIONS.has(collection)) {
    throw new Error(`Unsupported member-scoped collection: ${collection}`);
  }

  const existing = await getMemberScopedRowPg(collection, memberId);
  const id = existing?.id ?? (typeof payload.id === "string" ? payload.id : crypto.randomUUID());
  const actor = actorIdOrNull(payload.updated_by) ?? "system";

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
  await query("UPDATE limits SET member_id = $2, updated_at = now() WHERE member_id = $1", [oldId, newId]);
  await query("UPDATE member_tree_cache SET member_id = $2, updated_at = now() WHERE member_id = $1", [oldId, newId]);
  await query("UPDATE member_bans SET member_id = $2 WHERE member_id = $1", [oldId, newId]);
}

export const MEMBER_DATA_POSTGRES_ENTITY_KEYS = new Set([
  "employment",
  "time-settings",
  "limits",
  "member-tree-cache",
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
  if (entityKey === "employment") {
    const rows = await query("SELECT * FROM employment WHERE id = $1 LIMIT 1", [id]);
    return rows[0] ? normalizeMemberDataRow(rows[0]) : null;
  }
  const rows = await query("SELECT * FROM time_settings WHERE id = $1 LIMIT 1", [id]);
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
  const collection = entityKey === "employment" ? "employment" : "time_settings";
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
  const collection = entityKey === "employment" ? "employment" : "time_settings";
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
  const table = entityKey === "employment" ? "employment" : "time_settings";
  await query(`DELETE FROM ${table} WHERE id = $1`, [id]);
}
