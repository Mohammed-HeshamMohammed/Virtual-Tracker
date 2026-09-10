
import crypto from "node:crypto";
import { query } from "./client.js";
import { publishChange } from "../../modules/realtime/change-bus.js";

function uuidOrNull(value) {
  if (value === null || value === undefined) return null;
  const trimmed = String(value).trim();
  return trimmed ? trimmed : null;
}

const WRITABLE_COLUMNS = [
  "member_id",
  "project_id",
  "client_id",
  "date",
  "category",
  "description",
  "notes",
  "amount",
  "currency",
  "billable",
  "status",
  "reviewed_by",
  "reviewed_at",
  "receipt_url",
  "created_by",
  "updated_by",
];

const UUID_COLUMNS = new Set(["member_id", "project_id", "client_id"]);

export async function createExpensePg(data) {
  const id = uuidOrNull(data.id) ?? crypto.randomUUID();
  const columns = ["id"];
  const placeholders = ["$1"];
  const params = [id];

  for (const column of WRITABLE_COLUMNS) {
    if (!(column in data)) continue;
    columns.push(column);
    params.push(UUID_COLUMNS.has(column) ? uuidOrNull(data[column]) : data[column]);
    placeholders.push(`$${params.length}`);
  }

  const rows = await query(
    `INSERT INTO expenses (${columns.join(", ")}) VALUES (${placeholders.join(", ")}) RETURNING *`,
    params,
  );
  const created = rows[0] ?? null;
  if (created) void publishChange("expenses", String(created.id), "created", uuidOrNull(data.created_by) ?? undefined);
  return created;
}

export async function getExpensePg(id) {
  if (!id) return null;
  const rows = await query("SELECT * FROM expenses WHERE id = $1 LIMIT 1", [id]);
  return rows[0] ?? null;
}

export async function updateExpensePg(id, patch) {
  const sets = [];
  const params = [id];
  for (const column of WRITABLE_COLUMNS) {
    if (!(column in patch)) continue;
    params.push(UUID_COLUMNS.has(column) ? uuidOrNull(patch[column]) : patch[column]);
    sets.push(`${column} = $${params.length}`);
  }
  if (sets.length === 0) return getExpensePg(id);
  const rows = await query(`UPDATE expenses SET ${sets.join(", ")} WHERE id = $1 RETURNING *`, params);
  const updated = rows[0] ?? null;
  if (updated) void publishChange("expenses", String(updated.id), "updated", uuidOrNull(patch.updated_by) ?? undefined);
  return updated;
}

export async function deleteExpensePg(id, actorId) {
  await query("DELETE FROM expenses WHERE id = $1", [id]);
  void publishChange("expenses", String(id), "deleted", actorId ?? undefined);
}

export async function listExpensesPg(filters = {}) {
  const {
    memberIds = null,
    projectIds = null,
    fromDay = null,
    toDay = null,
    status = null,
    limit = 1000,
  } = filters;
  // Callers over-fetch by one to detect truncation, so the ceiling allows it.
  const safeLimit = Math.min(Math.max(limit, 1), 2001);

  const rows = await query(
    `SELECT e.*,
            COALESCE(p.name, '') AS project_name,
            COALESCE(c.name, '') AS client_name
     FROM expenses e
     LEFT JOIN projects p ON p.id = e.project_id
     LEFT JOIN clients c ON c.id = e.client_id
     WHERE ($1::uuid[] IS NULL OR e.member_id = ANY($1::uuid[]))
       AND ($2::uuid[] IS NULL OR e.project_id = ANY($2::uuid[]))
       AND ($3::date IS NULL OR e.date >= $3::date)
       AND ($4::date IS NULL OR e.date <= $4::date)
       AND ($5::text IS NULL OR e.status = $5::text)
     ORDER BY e.date DESC, e.created_at DESC
     LIMIT $6`,
    [memberIds, projectIds, fromDay, toDay, status, safeLimit],
  );
  return rows;
}
