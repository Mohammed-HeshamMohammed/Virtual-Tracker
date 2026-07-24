import crypto from "node:crypto";
import { COLLECTIONS } from "../../../lib/firestore/collections.js";
import { memberSchemas } from "./members/index.js";
import { employmentSchemas } from "./employment/index.js";
import { clientSchemas } from "./clients/index.js";
import { projectSchemas } from "./projects/index.js";
import { taskSchemas } from "./tasks/index.js";
import { teamSchemas } from "./teams/index.js";
import { activitySchemas } from "./activity/index.js";
import { memberRelationshipSchemas } from "./member-relationships/index.js";
import { memberTransferRequestSchemas } from "./hierarchy/index.js";
import { timesheetSchemas } from "./timesheets/index.js";
import { schemaRulesByKey } from "./rules.js";

export const schemaEntities = [
  ...memberSchemas,
  ...employmentSchemas,
  ...clientSchemas,
  ...projectSchemas,
  ...taskSchemas,
  ...teamSchemas,
  ...activitySchemas,
  ...memberRelationshipSchemas,
  ...memberTransferRequestSchemas,
  ...timesheetSchemas,
];
export const schemaByKey = new Map(schemaEntities.map((entity) => [entity.key, entity]));
export const foreignKeyCollectionByField = {
  member_id: "members",
  role_id: "roles",
  invite_id: "invites",
  project_id: COLLECTIONS.projects,
  job_title_id: "job_titles",
  department_id: "departments",
  job_type_id: "job_types",
  tax_type_id: "tax_types",
  client_id: "clients",
  task_id: "tasks",
  team_id: "teams",
  assigned_to: "members",
};
export function generateUUID() {
  return crypto.randomUUID();
}
export function now() {
  return new Date();
}
export { schemaRulesByKey };
