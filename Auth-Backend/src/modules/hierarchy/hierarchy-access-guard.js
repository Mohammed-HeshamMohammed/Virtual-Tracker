import { hasHierarchyAssignmentRestriction } from "./hierarchy-placement.js";

/** API path prefixes blocked when hierarchy assignment is required. */
const RESTRICTED_PATH_PREFIXES = [
  "/api/projects",
  "/api/tasks",
  "/api/teams",
  "/api/clients",
  "/api/members/preprovision",
  "/api/invites",
];

/** Paths always allowed even with hierarchy restriction. */
const ALLOWED_PATH_PREFIXES = [
  "/api/auth",
  "/api/bootstrap",
  "/api/notifications",
  "/api/member-transfer-requests",
  "/api/member-relationships/scoped-members",
  "/api/member-relationships/team-staffable-members",
  "/api/member-relationships/audit",
  "/api/public/member-transfer-requests",
];

/**
 * Check if a member with hierarchy restrictions may access this API path.
 *
 * @param {Record<string, unknown> | null | undefined} memberData
 * @param {string} pathname
 * @param {string} method
 * @returns {{ blocked: boolean; code?: string; error?: string }}
 */
export function checkHierarchyAccess(memberData, pathname, method = "GET") {
  if (!hasHierarchyAssignmentRestriction(memberData)) {
    return { blocked: false };
  }

  const normalized = pathname.replace(/^\/api\/v1\//, "/api/");

  for (const prefix of ALLOWED_PATH_PREFIXES) {
    if (normalized.startsWith(prefix)) return { blocked: false };
  }

  if (normalized.startsWith("/api/members/current") || normalized.includes("/profile")) {
    return { blocked: false };
  }

  for (const prefix of RESTRICTED_PATH_PREFIXES) {
    if (normalized.startsWith(prefix)) {
      return {
        blocked: true,
        code: "HIERARCHY_ASSIGNMENT_REQUIRED",
        error: "Hierarchy assignment is required before accessing organizational features. Contact your administrator.",
      };
    }
  }

  if (
    normalized.startsWith("/api/members") &&
    (method === "POST" || method === "PUT" || method === "PATCH" || method === "DELETE")
  ) {
    return {
      blocked: true,
      code: "HIERARCHY_ASSIGNMENT_REQUIRED",
      error: "Hierarchy assignment is required before managing members.",
    };
  }

  return { blocked: false };
}
