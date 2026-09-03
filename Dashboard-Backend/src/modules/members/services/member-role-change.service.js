import { validateOwnerRoleChange } from "../../../http/role-owner-policy.js";
import { resolveMemberRoleName } from "../../activity/activity-scope.js";
import { applyRoleChangeHierarchyEffects } from "../../hierarchy/hierarchy-sync.js";
import { syncMemberPrimaryRole } from "./relation-sync.js";
import { logSafeWarn } from "../../../http/sanitize-error.js";
import { publishChange } from "../../realtime/change-bus.js";

export function getProfilePatchSections(body) {
  const sections = [];
  if (body.info && typeof body.info === "object") sections.push("info");
  if (body.employment && typeof body.employment === "object") sections.push("employment");
  if (body.roles && typeof body.roles === "object") sections.push("roles");
  if (body.payBill && typeof body.payBill === "object") sections.push("payBill");
  if (body.workLimits && typeof body.workLimits === "object") sections.push("workLimits");
  if (body.settings && typeof body.settings === "object") sections.push("settings");
  return sections;
}

export function profilePatchNeedsBootstrap(body) {
  return Boolean(body.employment && typeof body.employment === "object");
}

export function isRoleOnlyProfilePatch(body) {
  const sections = getProfilePatchSections(body);
  return sections.length === 1 && sections[0] === "roles";
}

export function isSingleSectionProfilePatch(body, section) {
  const sections = getProfilePatchSections(body);
  return sections.length === 1 && sections[0] === section;
}

export function isLightProfilePatch(body) {
  const sections = getProfilePatchSections(body);
  if (sections.length !== 1) return false;
  return sections[0] === "roles" || sections[0] === "payBill" || sections[0] === "workLimits" || sections[0] === "settings";
}

export async function applyMemberRoleChange(db, input) {
  const memberId = input.memberId;
  const trimmed = typeof input.roleName === "string" ? input.roleName.trim() : "";
  if (!memberId || !trimmed) {
    throw new Error("Role name is required.");
  }

  const actorMemberId = typeof input.actorMemberId === "string" ? input.actorMemberId : "";
  const actorRoleNameInput = typeof input.actorRoleName === "string" ? input.actorRoleName : "";

  const [currentRoleName, resolvedActorRoleName] = await Promise.all([
    resolveMemberRoleName(db, memberId),
    actorRoleNameInput
      ? Promise.resolve(actorRoleNameInput)
      : actorMemberId
        ? resolveMemberRoleName(db, actorMemberId)
        : Promise.resolve(""),
  ]);

  const ownerErr = validateOwnerRoleChange(currentRoleName, trimmed);
  if (ownerErr) throw new Error(ownerErr);

  const roleId = await syncMemberPrimaryRole(db, memberId, trimmed, actorMemberId, resolvedActorRoleName);

  const hierarchyResult = await applyRoleChangeHierarchyEffects(db, {
    memberId,
    nextRoleName: trimmed,
    actorMemberId,
    actorRoleName: resolvedActorRoleName,
    deferBackground: true,
  });

  void publishChange("members", memberId, "updated", actorMemberId);

  return { roleId, roleName: trimmed, hierarchyResult };
}

export async function timeRoleChangeStep(step, fn) {
  const start = performance.now();
  try {
    return await fn();
  } finally {
    if (process.env.NODE_ENV !== "production") {
      logSafeWarn(`[member-role-change] ${step}: ${Math.round(performance.now() - start)}ms`);
    }
  }
}
