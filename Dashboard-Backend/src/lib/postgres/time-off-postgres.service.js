
import { query } from "./client.js";
import { publishChange } from "../../modules/realtime/change-bus.js";

function uuidOrNull(value) {
  if (value === null || value === undefined) return null;
  const trimmed = String(value).trim();
  return trimmed ? trimmed : null;
}

function toDayString(value) {
  if (!value) return "";
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value).slice(0, 10);
}


export async function listTimeOffPoliciesPg({ includeInactive = false } = {}) {
  return query(
    `SELECT * FROM time_off_policies
     WHERE ($1::boolean OR active = true)
     ORDER BY name ASC`,
    [includeInactive],
  );
}

export async function getTimeOffPolicyPg(id) {
  if (!id) return null;
  const rows = await query("SELECT * FROM time_off_policies WHERE id = $1 LIMIT 1", [id]);
  return rows[0] ?? null;
}

export async function createTimeOffPolicyPg(data) {
  const rows = await query(
    `INSERT INTO time_off_policies (name, description, days_per_year, paid, requires_approval, active, created_by, updated_by)
     VALUES ($1, $2, $3, $4, $5, true, $6, $6)
     RETURNING *`,
    [
      String(data.name ?? "").trim(),
      String(data.description ?? "").trim(),
      Number(data.days_per_year) || 0,
      data.paid !== false,
      data.requires_approval !== false,
      uuidOrNull(data.created_by),
    ],
  );
  const created = rows[0] ?? null;
  if (created) void publishChange("time-off-policies", String(created.id), "created", uuidOrNull(data.created_by) ?? undefined);
  return created;
}

export async function updateTimeOffPolicyPg(id, patch) {
  const columns = ["name", "description", "days_per_year", "paid", "requires_approval", "active", "updated_by"];
  const sets = [];
  const params = [id];
  for (const column of columns) {
    if (!(column in patch)) continue;
    params.push(patch[column]);
    sets.push(`${column} = $${params.length}`);
  }
  if (sets.length === 0) return getTimeOffPolicyPg(id);
  const rows = await query(`UPDATE time_off_policies SET ${sets.join(", ")} WHERE id = $1 RETURNING *`, params);
  const updated = rows[0] ?? null;
  if (updated) void publishChange("time-off-policies", String(id), "updated", uuidOrNull(patch.updated_by) ?? undefined);
  return updated;
}


export async function getTimeOffRequestPg(id) {
  if (!id) return null;
  const rows = await query("SELECT * FROM time_off_requests WHERE id = $1 LIMIT 1", [id]);
  return rows[0] ?? null;
}

export async function createTimeOffRequestPg(data) {
  const rows = await query(
    `INSERT INTO time_off_requests (member_id, policy_id, start_date, end_date, days, note, status)
     VALUES ($1, $2, $3, $4, $5, $6, 'pending')
     RETURNING *`,
    [
      uuidOrNull(data.member_id),
      uuidOrNull(data.policy_id),
      data.start_date,
      data.end_date,
      Number(data.days) || 0,
      String(data.note ?? "").trim(),
    ],
  );
  const created = rows[0] ?? null;
  if (created) void publishChange("time-off-requests", String(created.id), "created", uuidOrNull(data.member_id) ?? undefined);
  return created;
}

export async function listTimeOffRequestsPg(filters = {}) {
  const { memberIds = null, status = null, fromDay = null, toDay = null, limit = 500 } = filters;
  return query(
    `SELECT r.*, p.name AS policy_name, p.paid AS policy_paid
     FROM time_off_requests r
     JOIN time_off_policies p ON p.id = r.policy_id
     WHERE ($1::uuid[] IS NULL OR r.member_id = ANY($1::uuid[]))
       AND ($2::text IS NULL OR r.status = $2::text)
       AND ($3::date IS NULL OR r.end_date >= $3::date)
       AND ($4::date IS NULL OR r.start_date <= $4::date)
     ORDER BY r.start_date DESC
     LIMIT $5`,
    [memberIds, status, fromDay, toDay, Math.min(Math.max(limit, 1), 2000)],
  );
}

export async function reviewTimeOffRequestPg(id, { status, reviewerId, reviewNote = "" }) {
  const rows = await query(
    `UPDATE time_off_requests
     SET status = $2, reviewed_by = $3, reviewed_at = now(), review_note = $4
     WHERE id = $1
     RETURNING *`,
    [id, status, uuidOrNull(reviewerId), String(reviewNote ?? "").trim()],
  );
  const updated = rows[0] ?? null;
  if (!updated) return null;

  if (status === "approved") {
    await query(
      `INSERT INTO time_off_transactions (member_id, policy_id, request_id, kind, days, effective_on, note, created_by)
       VALUES ($1, $2, $3, 'usage', $4, $5, $6, $7)
       ON CONFLICT (request_id) WHERE request_id IS NOT NULL DO NOTHING`,
      [
        updated.member_id,
        updated.policy_id,
        updated.id,
        -Math.abs(Number(updated.days) || 0),
        updated.start_date,
        "Approved time off",
        uuidOrNull(reviewerId),
      ],
    );
  } else {
    await query("DELETE FROM time_off_transactions WHERE request_id = $1", [id]);
  }

  void publishChange("time-off-requests", String(id), "updated", uuidOrNull(reviewerId) ?? undefined);
  return updated;
}


export async function createTimeOffTransactionPg(data) {
  const rows = await query(
    `INSERT INTO time_off_transactions (member_id, policy_id, kind, days, effective_on, note, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING *`,
    [
      uuidOrNull(data.member_id),
      uuidOrNull(data.policy_id),
      data.kind,
      Number(data.days) || 0,
      data.effective_on,
      String(data.note ?? "").trim(),
      uuidOrNull(data.created_by),
    ],
  );
  const created = rows[0] ?? null;
  if (created) void publishChange("time-off-transactions", String(created.id), "created", uuidOrNull(data.created_by) ?? undefined);
  return created;
}

export async function getTimeOffTransactionRowsPg({ memberIds = null, fromDay, toDay, policyIds = null }) {
  const rows = await query(
    `SELECT t.id, t.member_id, t.policy_id, t.request_id, t.kind, t.days,
            t.effective_on, t.note, t.created_at,
            p.name AS policy_name
     FROM time_off_transactions t
     JOIN time_off_policies p ON p.id = t.policy_id
     WHERE t.effective_on >= $1 AND t.effective_on <= $2
       AND ($3::uuid[] IS NULL OR t.member_id = ANY($3::uuid[]))
       AND ($4::uuid[] IS NULL OR t.policy_id = ANY($4::uuid[]))
     ORDER BY t.effective_on DESC, t.created_at DESC
     LIMIT 2000`,
    [fromDay, toDay, memberIds, policyIds],
  );
  return rows.map((r) => ({
    id: String(r.id),
    memberId: String(r.member_id),
    policyId: String(r.policy_id),
    policyName: r.policy_name,
    requestId: r.request_id ? String(r.request_id) : null,
    kind: r.kind,
    days: Number(r.days) || 0,
    effectiveOn: toDayString(r.effective_on),
    note: r.note || "",
  }));
}

export async function getTimeOffBalanceRowsPg({ memberIds = null, asOf }) {
  const rows = await query(
    `SELECT m.id AS member_id, p.id AS policy_id, p.name AS policy_name,
            p.days_per_year,
            COALESCE(SUM(t.days) FILTER (WHERE t.effective_on <= $2::date), 0) AS balance_days,
            COALESCE(-SUM(t.days) FILTER (WHERE t.kind = 'usage' AND t.effective_on <= $2::date), 0) AS used_days,
            COALESCE(SUM(t.days) FILTER (WHERE t.kind = 'accrual' AND t.effective_on <= $2::date), 0) AS accrued_days
     FROM members m
     CROSS JOIN time_off_policies p
     LEFT JOIN time_off_transactions t
       ON t.member_id = m.id AND t.policy_id = p.id
     WHERE p.active = true
       AND m.status <> 'banned'
       AND ($1::uuid[] IS NULL OR m.id = ANY($1::uuid[]))
     GROUP BY m.id, p.id, p.name, p.days_per_year
     -- Filtered by the same "as of" date as the columns above. It used to sum
     -- every transaction ever, so a member's row could appear or vanish on the
     -- strength of activity that had not happened yet at the date being asked
     -- about.
     HAVING COALESCE(SUM(t.days) FILTER (WHERE t.effective_on <= $2::date), 0) <> 0
         OR p.days_per_year > 0
     ORDER BY p.name ASC
     LIMIT 2000`,
    [memberIds, asOf],
  );
  return rows.map((r) => ({
    memberId: String(r.member_id),
    policyId: String(r.policy_id),
    policyName: r.policy_name,
    entitlementDays: Number(r.days_per_year) || 0,
    accruedDays: Number(r.accrued_days) || 0,
    usedDays: Number(r.used_days) || 0,
    balanceDays: Number(r.balance_days) || 0,
  }));
}
