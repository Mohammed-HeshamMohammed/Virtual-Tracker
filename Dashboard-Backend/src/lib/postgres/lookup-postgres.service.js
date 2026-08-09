import crypto from "node:crypto";
import { query } from "./client.js";
import { getLookupData, invalidateLookupCache } from "./lookup-cache.js";

/**
 * Actor-id columns (created_by/updated_by) store either an internal member UUID or a
 * Firebase Auth uid (28-char alphanumeric) — both are valid VARCHAR(255) values.
 */
function actorIdOrNull(value) {
  if (value === null || value === undefined) return null;
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.slice(0, 255);
}

export const LOOKUP_POSTGRES_ENTITY_KEYS = new Set([
  "roles",
  "job-titles",
  "departments",
  "job-types",
  "tax-types",
]);

/** @type {Record<string, string>} */
export const LOOKUP_ENTITY_CATEGORY = {
  "job-titles": "job_title",
  departments: "department",
  "job-types": "job_type",
  "tax-types": "tax_type",
};

/** @type {Record<string, string>} */
export const LOOKUP_COLLECTION_TO_CATEGORY = {
  job_titles: "job_title",
  departments: "department",
  job_types: "job_type",
  tax_types: "tax_type",
};

export const ORG_FIELD_OPTION_TYPES = new Set([
  "jobTitle",
  "department",
  "jobType",
  "employmentType",
  "employedThrough",
  "workplaceModel",
  "taxType",
  "terminationReason",
]);

const ROLE_COLUMNS = ["id", "name", "description", "created_at", "created_by", "updated_by", "updated_at"];
const LOOKUP_COLUMNS = ["id", "category", "name", "list_ranking", "created_at", "created_by", "updated_by", "updated_at"];

/**
 * @param {Record<string, unknown>} row
 * @returns {Record<string, unknown>}
 */
export function normalizeLookupRow(row) {
  const out = { ...row };
  for (const [key, value] of Object.entries(out)) {
    if (value instanceof Date) {
      out[key] = value.toISOString();
    }
    const camel = key.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
    if (camel !== key) out[camel] = out[key];
  }
  return out;
}

/**
 * @param {string} entityKey
 */
export function isLookupPostgresEntityKey(entityKey) {
  return LOOKUP_POSTGRES_ENTITY_KEYS.has(entityKey);
}

/**
 * @param {string} entityKey
 * @param {URL} url
 */
export async function listLookupPostgresRows(entityKey, url) {
  if (entityKey === "roles") {
    const rows = await query(`SELECT ${ROLE_COLUMNS.join(", ")} FROM roles ORDER BY name LIMIT 200`);
    return rows.map(normalizeLookupRow);
  }

  const category = LOOKUP_ENTITY_CATEGORY[entityKey];
  const conditions = ["category = $1"];
  const params = [category];
  for (const field of ["name", "list_ranking"]) {
    const value = url.searchParams.get(field) ?? url.searchParams.get(field.replace(/_([a-z])/g, (_, c) => c.toUpperCase()));
    if (value !== null && value !== "") {
      params.push(value);
      conditions.push(`${field} = $${params.length}`);
    }
  }
  const rows = await query(
    `SELECT ${LOOKUP_COLUMNS.join(", ")} FROM lookup_tables WHERE ${conditions.join(" AND ")} ORDER BY list_ranking, name LIMIT 200`,
    params,
  );
  return rows.map(normalizeLookupRow);
}

/**
 * @param {string} entityKey
 * @param {string} id
 */
export async function getLookupPostgresRow(entityKey, id) {
  if (entityKey === "roles") {
    const rows = await query(`SELECT ${ROLE_COLUMNS.join(", ")} FROM roles WHERE id = $1 LIMIT 1`, [id]);
    return rows[0] ? normalizeLookupRow(rows[0]) : null;
  }
  const category = LOOKUP_ENTITY_CATEGORY[entityKey];
  const rows = await query(
    `SELECT ${LOOKUP_COLUMNS.join(", ")} FROM lookup_tables WHERE id = $1 AND category = $2 LIMIT 1`,
    [id, category],
  );
  return rows[0] ? normalizeLookupRow(rows[0]) : null;
}

/**
 * @param {string} entityKey
 * @param {Record<string, unknown>} payload
 */
export async function createLookupPostgresRow(entityKey, payload) {
  if (entityKey === "roles") {
    const rows = await query(
      `INSERT INTO roles (id, name, description, created_by, updated_by)
       VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (name) DO NOTHING
       RETURNING ${ROLE_COLUMNS.join(", ")}`,
      [
        payload.id,
        payload.name,
        payload.description ?? null,
        actorIdOrNull(payload.created_by),
        actorIdOrNull(payload.updated_by),
      ],
    );
    invalidateLookupCache();
    if (rows[0]) return normalizeLookupRow(rows[0]);
    // Another concurrent request already seeded this role name — return it instead of erroring.
    const existing = await query(`SELECT ${ROLE_COLUMNS.join(", ")} FROM roles WHERE name = $1 LIMIT 1`, [payload.name]);
    return existing[0] ? normalizeLookupRow(existing[0]) : null;
  }

  const category = LOOKUP_ENTITY_CATEGORY[entityKey];
  const rows = await query(
    `INSERT INTO lookup_tables (id, category, name, list_ranking, created_by, updated_by)
     VALUES ($1,$2,$3,$4,$5,$6)
     ON CONFLICT (category, name) DO NOTHING
     RETURNING ${LOOKUP_COLUMNS.join(", ")}`,
    [
      payload.id,
      category,
      payload.name,
      payload.list_ranking ?? null,
      actorIdOrNull(payload.created_by),
      actorIdOrNull(payload.updated_by),
    ],
  );
  invalidateLookupCache();
  if (rows[0]) return normalizeLookupRow(rows[0]);
  // Another concurrent request already seeded this category/name — return it instead of erroring.
  const existing = await query(
    `SELECT ${LOOKUP_COLUMNS.join(", ")} FROM lookup_tables WHERE category = $1 AND name = $2 LIMIT 1`,
    [category, payload.name],
  );
  return existing[0] ? normalizeLookupRow(existing[0]) : null;
}

/**
 * @param {string} entityKey
 * @param {string} id
 * @param {Record<string, unknown>} payload
 * @param {Record<string, unknown>} existing
 */
export async function updateLookupPostgresRow(entityKey, id, payload, existing) {
  if (entityKey === "roles") {
    const merged = { ...existing, ...payload, id };
    const rows = await query(
      `UPDATE roles SET name = $2, description = $3, updated_by = $4 WHERE id = $1
       RETURNING ${ROLE_COLUMNS.join(", ")}`,
      [id, merged.name, merged.description ?? null, merged.updated_by ?? null],
    );
    invalidateLookupCache();
    return normalizeLookupRow(rows[0]);
  }

  const category = LOOKUP_ENTITY_CATEGORY[entityKey];
  const merged = { ...existing, ...payload, id };
  const rows = await query(
    `UPDATE lookup_tables SET name = $3, list_ranking = $4, updated_by = $5
     WHERE id = $1 AND category = $2
     RETURNING ${LOOKUP_COLUMNS.join(", ")}`,
    [id, category, merged.name, merged.list_ranking ?? null, merged.updated_by ?? null],
  );
  invalidateLookupCache();
  return normalizeLookupRow(rows[0]);
}

/**
 * @param {string} entityKey
 * @param {string} id
 */
export async function deleteLookupPostgresRow(entityKey, id) {
  if (entityKey === "roles") {
    await query("DELETE FROM roles WHERE id = $1", [id]);
  } else {
    const category = LOOKUP_ENTITY_CATEGORY[entityKey];
    await query("DELETE FROM lookup_tables WHERE id = $1 AND category = $2", [id, category]);
  }
  invalidateLookupCache();
}

/**
 * @param {string} collection
 * @param {string} id
 */
export async function lookupRowExistsInPostgres(collection, id) {
  if (!id) return false;
  if (collection === "roles") {
    const rows = await query("SELECT 1 FROM roles WHERE id = $1 LIMIT 1", [id]);
    return rows.length > 0;
  }
  const category = LOOKUP_COLLECTION_TO_CATEGORY[collection];
  if (!category) return false;
  const rows = await query("SELECT 1 FROM lookup_tables WHERE id = $1 AND category = $2 LIMIT 1", [id, category]);
  return rows.length > 0;
}

/**
 * @param {string} roleId
 */
export async function resolveRoleNameByIdPg(roleId) {
  if (!roleId) return "";
  const data = await getLookupData();
  const row = data.roles.find((r) => String(r.id) === roleId);
  return typeof row?.name === "string" ? row.name.trim() : "";
}

/**
 * @param {string} roleName
 */
export async function resolveRoleIdByNamePg(roleName) {
  const name = typeof roleName === "string" && roleName.trim() ? roleName.trim() : "User";
  const data = await getLookupData();
  const exact = data.roles.find((r) => typeof r.name === "string" && r.name === name);
  if (exact?.id) return String(exact.id);
  const ci = data.roles.find((r) => typeof r.name === "string" && r.name.toLowerCase() === name.toLowerCase());
  if (ci?.id) return String(ci.id);

  const id = crypto.randomUUID();
  await createLookupPostgresRow("roles", {
    id,
    name,
    description: "",
    created_by: null,
    updated_by: null,
  });
  return id;
}

/**
 * @param {string[]} names
 */
export async function ensureDefaultRolesPg(names) {
  const data = await getLookupData();
  const existing = new Set(
    data.roles
      .map((r) => r.name)
      .filter((n) => typeof n === "string")
      .map((n) => n.toLowerCase()),
  );
  for (const name of names) {
    if (existing.has(name.toLowerCase())) continue;
    await resolveRoleIdByNamePg(name);
  }
}

/**
 * @param {string} collection
 * @param {string} name
 */
export async function resolveLookupIdByNamePg(collection, name) {
  const trimmed = typeof name === "string" ? name.trim() : "";
  if (!trimmed) return "";
  const category = LOOKUP_COLLECTION_TO_CATEGORY[collection];
  if (!category) return "";

  const data = await getLookupData();
  const exact = data.lookups.find((r) => r.category === category && r.name === trimmed);
  if (exact?.id) return String(exact.id);

  const id = crypto.randomUUID();
  const entityKey = Object.entries(LOOKUP_ENTITY_CATEGORY).find(([, c]) => c === category)?.[0];
  if (!entityKey) return "";
  await createLookupPostgresRow(entityKey, {
    id,
    name: trimmed,
    list_ranking: "",
    created_by: null,
    updated_by: null,
  });
  return id;
}

/**
 * @param {string} collection
 * @param {string} id
 */
export async function lookupNameByIdPg(collection, id) {
  if (!id) return "";
  const category = LOOKUP_COLLECTION_TO_CATEGORY[collection];
  if (!category) return "";
  const data = await getLookupData();
  const row = data.lookups.find((r) => r.category === category && String(r.id) === id);
  return typeof row?.name === "string" ? row.name : "";
}

/**
 * @param {string} type
 */
export async function listOrgFieldOptionsPg(type) {
  const data = await getLookupData();
  return data.orgOptions
    .filter((row) => row.type === type)
    .map((row) =>
      normalizeLookupRow({
        id: row.id,
        type: row.type,
        label: row.label,
        position: row.position,
        created_at: row.created_at,
        updated_at: row.updated_at,
        modifiedBy: row.modified_by,
      }),
    );
}

/**
 * @param {{ type: string; label: string; position?: number; modified_by?: string }} payload
 */
export async function createOrgFieldOptionPg(payload) {
  const id = crypto.randomUUID();
  const rows = await query(
    `INSERT INTO org_field_options (id, type, label, position, modified_by)
     VALUES ($1,$2,$3,$4,$5)
     RETURNING id, type, label, position, created_at, updated_at, modified_by`,
    [id, payload.type, payload.label, payload.position ?? 0, payload.modified_by ?? null],
  );
  invalidateLookupCache();
  const row = rows[0];
  return normalizeLookupRow({
    ...row,
    modifiedBy: row.modified_by,
  });
}

/**
 * @param {string} collection
 * @param {string[]} names
 * @param {string} actor
 */
export async function seedLookupTablePostgresIfEmpty(collection, names, actor) {
  const category = LOOKUP_COLLECTION_TO_CATEGORY[collection];
  if (!category) return [];
  const [{ count }] = await query(
    "SELECT COUNT(*)::int AS count FROM lookup_tables WHERE category = $1",
    [category],
  );
  if (Number(count) > 0) return [];

  const entityKey = Object.entries(LOOKUP_ENTITY_CATEGORY).find(([, c]) => c === category)?.[0];
  if (!entityKey) return [];

  const created = [];
  for (let i = 0; i < names.length; i++) {
    await createLookupPostgresRow(entityKey, {
      id: crypto.randomUUID(),
      name: names[i],
      list_ranking: String(i),
      created_by: actor || null,
      updated_by: actor || null,
    });
    created.push(collection);
  }
  return created;
}

/**
 * @param {string} type
 * @param {string[]} labels
 */
export async function seedOrgFieldOptionsPostgresIfEmpty(type, labels) {
  const [{ count }] = await query(
    "SELECT COUNT(*)::int AS count FROM org_field_options WHERE type = $1",
    [type],
  );
  if (Number(count) > 0) return [];

  const created = [];
  for (let i = 0; i < labels.length; i++) {
    await createOrgFieldOptionPg({ type, label: labels[i], position: i });
    created.push(`org_field_options:${type}`);
  }
  return created;
}
