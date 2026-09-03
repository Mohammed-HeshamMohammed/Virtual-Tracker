import { readJsonBody } from "../../http/read-json-body.js";
import { rejectUnknownFields } from "../../http/validate-body.js";

export async function readCompatBody(req, allowedKeys) {
  const body = await readJsonBody(req);
  rejectUnknownFields(body, allowedKeys);
  return body;
}

export const COMPAT_BODY_SCHEMAS = {
  batchDelete: ["ids"],
  batchUpdate: ["ids", "payBill", "workLimits"],
  createMember: [
    "name",
    "email",
    "role",
    "payRate",
    "currency",
    "projects",
    "status",
    "lastIp",
    "createdBy",
    "createdByUid",
  ],
  patchMember: [
    "name",
    "email",
    "status",
    "lastIp",
    "updatedBy",
    "role",
    "payRate",
    "currency",
    "weeklyLimit",
    "trackingStatus",
  ],
  patchMemberRole: ["role", "updatedBy"],
  patchProfile: [
    "updatedBy",
    "info",
    "employment",
    "roles",
    "payBill",
    "workLimits",
    "settings",
    "expected_updated_at",
    "expectedUpdatedAt",
  ],
  createInvite: ["email", "roleId", "payRate", "currency", "createdBy", "createdByUid"],
  bulkInvites: ["rows", "role", "inviteKind", "appOrigin", "createdBy", "createdByUid"],
  bulkInviteRow: ["email", "pay_rate", "payRate", "currency", "created_by"],
  patchInvite: ["status", "pay_rate", "role_id", "role", "currency"],
  orgFieldOption: [
    "type",
    "recordType",
    "label",
    "position",
    "memberDocId",
    "formData",
    "modifiedBy",
  ],
};
