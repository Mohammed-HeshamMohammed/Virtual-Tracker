import { Timestamp } from "firebase-admin/firestore";
import { validateRoleAssignment } from "../../../http/role-assignment-guard.js";
import { assertCanBeTeamMemberRole } from "../../../http/team-member-assign-policy.js";
import { resolveMemberRoleName } from "../../activity/activity-scope.js";
import { isManagementRole } from "../../tasks/task-assignments.js";
import { rejectUnknownEntityFields } from "../../../http/validate-body.js";
import { isPostgresLookupReady } from "../../../lib/postgres/lookup-availability.js";
import { lookupRowExistsInPostgres } from "../../../lib/postgres/lookup-postgres.service.js";
import { foreignKeyCollectionByField, generateUUID, now, schemaRulesByKey } from "../catalog/index.js";

const LOOKUP_FK_COLLECTIONS = new Set(["roles", "job_titles", "departments", "job_types", "tax_types"]);

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const snakeToCamel = (input) => input.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
const canonicalInputField = (field, body) => Object.prototype.hasOwnProperty.call(body, field) ? body[field] : body[snakeToCamel(field)];
const isDateLike = (value) => (value instanceof Date && !Number.isNaN(value.getTime())) || (typeof value === "string" && !Number.isNaN(Date.parse(value)));

export function normalizeDoc(data) {
  const out = {};
  for (const [key, value] of Object.entries(data)) {
    const normalized = value instanceof Timestamp ? value.toDate().toISOString() : value instanceof Date ? value.toISOString() : value;
    out[key] = normalized;
    const camel = snakeToCamel(key);
    if (camel !== key) out[camel] = normalized;
  }
  return out;
}

function coerceField(type, value) {
  if (value === null || value === undefined) return value;
  if (type === "uuid") { if (typeof value !== "string" || !UUID_RE.test(value)) throw new Error("expected uuid"); return value; }
  if (type === "string" || type === "text") { if (typeof value !== "string") throw new Error("expected string"); return value; }
  if (type === "boolean") { if (typeof value !== "boolean") throw new Error("expected boolean"); return value; }
  if (type === "decimal") { if (typeof value !== "number" || Number.isNaN(value)) throw new Error("expected number"); return value; }
  if (type === "int") { if (!Number.isInteger(value)) throw new Error("expected integer"); return value; }
  if (type === "timestamp" || type === "date") { if (!isDateLike(value)) throw new Error(`expected ${type}`); return new Date(value); }
  return value;
}

export function buildCreatePayload(entity, body, options = {}) {
  rejectUnknownEntityFields(body, entity.fields, options.extraAllowedFields ?? []);
  const payload = { id: generateUUID() };
  for (const [field, type] of Object.entries(entity.fields)) {
    if (field === "id") continue;
    const value = canonicalInputField(field, body);
    if (value !== undefined) payload[field] = coerceField(type, value);
  }
  if (entity.fields.created_at && !payload.created_at) payload.created_at = now();
  if (entity.fields.updated_at && !payload.updated_at) payload.updated_at = now();
  if (entity.fields.date_added && !payload.date_added) payload.date_added = now();
  return payload;
}

export function buildUpdatePayload(entity, body, options = {}) {
  rejectUnknownEntityFields(body, entity.fields, options.extraAllowedFields ?? []);
  const payload = {};
  for (const [field, type] of Object.entries(entity.fields)) {
    if (field === "id") continue;
    const value = canonicalInputField(field, body);
    if (value !== undefined) payload[field] = coerceField(type, value);
  }
  if (entity.fields.updated_at) payload.updated_at = now();
  return payload;
}

/** Stamp auth metadata on team writes (Engineering Constitution §4 — backend authority). */
export function applyTeamWriteMetadata(entityKey, payload, memberId, isCreate = true) {
  if (!memberId || !payload || typeof payload !== "object") return payload;
  if (entityKey === "teams") {
    if (isCreate && !payload.created_by) payload.created_by = memberId;
    payload.updated_by = memberId;
    if (!isCreate) {
      delete payload.created_by;
      delete payload.last_weekly_report_sent_at;
    }
  }
  if (entityKey === "team-members") {
    if (isCreate) {
      if (!payload.assigned_by) payload.assigned_by = memberId;
      if (!payload.joined_at) payload.joined_at = now();
    }
    payload.updated_by = memberId;
  }
  if (entityKey === "team-projects" && isCreate) {
    if (!payload.assigned_by) payload.assigned_by = memberId;
    if (!payload.assigned_at) payload.assigned_at = now();
  }
  return payload;
}

async function assertTeamLinkedToProject(db, projectId, teamId) {
  const snap = await db.collection("team_projects").where("project_id", "==", projectId).limit(200).get();
  const linked = snap.docs.some((doc) => {
    const row = doc.data() || {};
    return String(row.team_id || row.teamId || "") === String(teamId);
  });
  if (!linked) throw new Error("team_id must be a team assigned to this project");
}

export async function validateForeignKeys(db, payload, options = {}) {
  for (const [field, value] of Object.entries(payload)) {
    const collection = foreignKeyCollectionByField[field];
    if (!collection || !value) continue;
    if ((await isPostgresLookupReady()) && LOOKUP_FK_COLLECTIONS.has(collection)) {
      const exists = await lookupRowExistsInPostgres(collection, String(value));
      if (!exists) throw new Error(`${field} references missing ${collection}`);
      continue;
    }
    const doc = await db.collection(collection).doc(value).get();
    if (!doc.exists) throw new Error(`${field} references missing ${collection}`);
  }

  const projectId = payload.project_id ?? options.projectId;
  const teamId = payload.team_id;
  // Tasks must reference a team already linked to the project; team-projects creates that link.
  if (teamId && projectId && options.entityKey === "tasks") {
    await assertTeamLinkedToProject(db, projectId, teamId);
  }
}

export function validateRequiredFields(entityKey, payload) {
  const rules = schemaRulesByKey[entityKey];
  if (!rules?.requiredOnCreate?.length) return;
  for (const field of rules.requiredOnCreate) {
    const value = payload[field];
    if (value === undefined || value === null || (typeof value === "string" && !value.trim())) throw new Error(`${field} is required`);
  }
}

export async function validateBusinessRules(entityKey, payload, db, options = {}) {
  const rules = schemaRulesByKey[entityKey];
  if (!rules?.validators?.length) return;
  for (const validator of rules.validators) {
    if (!Object.prototype.hasOwnProperty.call(payload, validator.field)) continue;
    const value = payload[validator.field];
    if (value === undefined || value === null) continue;
    if (!validator.validate(value, payload)) throw new Error(validator.message);
  }

  if (["members", "invites"].includes(entityKey)) {
    const actorRoleName = typeof options.actorRoleName === "string" ? options.actorRoleName : "";
    const roleId = typeof payload.role_id === "string" ? payload.role_id.trim() : "";
    const roleName =
      roleId || entityKey === "members"
        ? ""
        : typeof payload.role_name === "string"
          ? payload.role_name
          : typeof payload.roleName === "string"
            ? payload.roleName
            : typeof payload.role === "string"
              ? payload.role
              : "";
    const roleErr = await validateRoleAssignment(db, actorRoleName, { roleName, roleId });
    if (roleErr) throw new Error(roleErr);
  }

  if (entityKey === "tasks" && payload.status === "in_review") {
    throw new Error("Cannot set status to in_review manually. Review is triggered when logged hours reach expected workload.");
  }

  if (entityKey === "tasks" && (payload.status === "done" || payload.completed === true)) {
    const actorRoleName = typeof options.actorRoleName === "string" ? options.actorRoleName : "";
    if (!isManagementRole(actorRoleName)) {
      throw new Error("Only management can mark tasks as Completed via the timesheet approval workflow.");
    }
  }

  if (entityKey === "team-members") {
    const memberId = typeof payload.member_id === "string" ? payload.member_id.trim() : "";
    if (memberId) {
      const roleName = await resolveMemberRoleName(db, memberId);
      assertCanBeTeamMemberRole(roleName);
    }
  }
}
