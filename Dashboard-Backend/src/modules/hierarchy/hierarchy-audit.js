import { resolveMemberRoleName } from "../activity/activity-scope.js";
import { fetchAllDocs } from "../../lib/firestore/paginate-all.js";
import {
  classifyHierarchyPlacement,
  HIERARCHY_STATUS,
  isOrphanEmployeeViolation,
  resolveHierarchyStatus,
} from "./hierarchy-placement.js";

/**
 * @typedef {Object} HierarchyViolation
 * @property {string} member_id
 * @property {string} role_name
 * @property {string | null} parent_member_id
 * @property {string} violation_type
 * @property {string} recommended_action
 */

/** Read-only hierarchy violation scan (no writes). */
export async function auditHierarchyViolations(db, options = {}) {
  const [membersDocs, relsDocs] = await Promise.all([
    fetchAllDocs(db.collection("members")),
    fetchAllDocs(db.collection("member_relationships")),
  ]);

  const childToParent = new Map();
  for (const doc of relsDocs) {
    const data = doc.data();
    if (typeof data.child_member_id === "string" && typeof data.parent_member_id === "string") {
      childToParent.set(data.child_member_id, data.parent_member_id);
    }
  }

  /** @type {HierarchyViolation[]} */
  const violations = [];
  /** @type {Array<{ member_id: string; role_name: string; hierarchy_status: string; parent_member_id: string | null }>} */
  const summary = [];

  for (const doc of membersDocs) {
    const data = doc.data() || {};
    const memberId = doc.id;
    const roleName = await resolveMemberRoleName(db, memberId);
    const parentId = childToParent.get(memberId) ?? null;
    const placement = classifyHierarchyPlacement(roleName, parentId, data);
    const expectedStatus = resolveHierarchyStatus(roleName, parentId, data);
    const storedStatus = typeof data.hierarchy_status === "string" ? data.hierarchy_status : null;

    summary.push({
      member_id: memberId,
      role_name: roleName,
      hierarchy_status: storedStatus || expectedStatus,
      parent_member_id: parentId,
    });

    if (placement === "external") continue;

    if (placement === "invalid") {
      let violationType = "hierarchy_placement_invalid";
      let recommendedAction = "Assign a parent in the hierarchy or grant membership entitlement.";

      if (isOrphanEmployeeViolation(roleName, parentId)) {
        violationType = "orphan_employee";
        recommendedAction = "Assign employee to a manager or super manager in the hierarchy.";
      }

      violations.push({
        member_id: memberId,
        role_name: roleName,
        parent_member_id: parentId,
        violation_type: violationType,
        recommended_action: recommendedAction,
      });
    }

    if (storedStatus && storedStatus !== expectedStatus && placement !== "invalid" && placement !== "external") {
      violations.push({
        member_id: memberId,
        role_name: roleName,
        parent_member_id: parentId,
        violation_type: "hierarchy_status_mismatch",
        recommended_action: `Update hierarchy_status from "${storedStatus}" to "${expectedStatus}".`,
      });
    }
  }

  return {
    audited_at: new Date().toISOString(),
    member_count: membersDocs.length,
    violation_count: violations.length,
    violations,
    orphan_employees: violations.filter((v) => v.violation_type === "orphan_employee"),
    repair_recommendations: violations.map((v) => ({
      member_id: v.member_id,
      action: v.recommended_action,
    })),
    migration_strategy: {
      description: "Do not auto-modify data. Review violations, assign parents via admin tools or transfer requests, then run status sync.",
      steps: [
        "Export audit report for Owner / Super Admin / Admin review.",
        "For orphan employees: assign parent via role change (auto-parent) or manual relationship.",
        "For Manager/Super Manager without parent: grant entitlement or assign to hierarchy.",
        "Run POST /api/member-relationships/repair-status to sync hierarchy_status fields (dry-run first).",
      ],
    },
    status_constants: HIERARCHY_STATUS,
    summary,
  };
}
