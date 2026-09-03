import crypto from "node:crypto";
import {
  classifyHierarchyPlacement,
  isExcludedFromHierarchy,
  isOrganizationAdminRole,
  isOrganizationRootRole,
} from "../../hierarchy/hierarchy-placement.js";
import { loadRoleNameById, normalizeRoleKey, rolePrivilegeRank } from "./relation-sync.js";
import { query as pgQuery } from "../../../lib/postgres/client.js";
import { listMembersPg } from "../../../lib/postgres/members-postgres.service.js";

const MIN_EMPLOYEE_ID_LENGTH = 2;
const MAX_EMPLOYEE_ID_LENGTH = 48;

function timestampMs(value) {
  if (!value) return 0;
  if (typeof value === "object" && value !== null && typeof value.toDate === "function") {
    return value.toDate().getTime();
  }
  const ms = new Date(/** @type {string | number | Date} */ (value)).getTime();
  return Number.isFinite(ms) ? ms : 0;
}

function sanitizeEmployeeId(raw) {
  return String(raw || "")
    .replace(/[^a-zA-Z0-9]/g, "")
    .slice(0, MAX_EMPLOYEE_ID_LENGTH);
}

function normalizeForCompare(raw) {
  return sanitizeEmployeeId(raw).toLowerCase();
}

function slugFromFirstName(firstName, fullName, email) {
  let slug = (typeof firstName === "string" ? firstName : "").trim().replace(/[^a-zA-Z0-9]/g, "");
  if (!slug && typeof fullName === "string") {
    const first = fullName.trim().split(/\s+/)[0] || "";
    slug = first.replace(/[^a-zA-Z0-9]/g, "");
  }
  if (!slug && typeof email === "string") {
    slug = (email.split("@")[0] || "").replace(/[^a-zA-Z0-9]/g, "").slice(0, 12);
  }
  if (!slug) slug = "Em";
  return slug.charAt(0).toUpperCase() + slug.slice(1).toLowerCase();
}

function rolePresenceCode(roleName) {
  const key = normalizeRoleKey(roleName);
  if (isOrganizationRootRole(roleName)) return "O";
  if (isOrganizationAdminRole(roleName)) return "A";
  if (key === "supermanager" || key === "supermanger" || key === "manager") return "M";
  if (key.startsWith("employee")) return "E";
  return "X";
}

function pseudoRandomMiddle(memberId, attempt) {
  const hash = crypto.createHash("sha256").update(`${memberId}:${attempt}`).digest("hex");
  return String(parseInt(hash.slice(0, 4), 16) % 90 + 10);
}


function buildEmployeeIdCandidate(nameSlug, metrics, attempt, memberId) {
  const seq = String(metrics.treeSequence);
  const middleParts = [
    String(metrics.depth),
    String(metrics.ancestorRoleCount),
    String(metrics.ancestorCount),
    metrics.roleCode,
    String(metrics.siblingIndex),
    pseudoRandomMiddle(memberId, attempt),
  ];

  const strategies = [
    () => `${nameSlug}${seq}`,
    () => `${nameSlug}${metrics.depth}${seq}`,
    () => `${nameSlug}${metrics.depth}${metrics.ancestorRoleCount}${seq}`,
    () => `${nameSlug}${metrics.depth}${metrics.ancestorCount}${seq}`,
    () => `${nameSlug}${metrics.roleCode}${seq}`,
    () => `${nameSlug}${metrics.depth}${metrics.roleCode}${seq}`,
    () => `${nameSlug}${metrics.depth}${metrics.ancestorRoleCount}${metrics.siblingIndex}${seq}`,
    () => `${nameSlug}${metrics.depth}${metrics.ancestorCount}${metrics.siblingIndex}${seq}`,
    () => `${nameSlug}${metrics.depth}${metrics.roleCode}${metrics.siblingIndex}${seq}`,
  ];

  if (attempt < strategies.length) {
    return sanitizeEmployeeId(strategies[attempt]());
  }

  const rotated = [...middleParts];
  for (let i = 0; i < attempt % middleParts.length; i += 1) {
    rotated.push(rotated.shift());
  }
  const picked = rotated.slice(0, 2 + (attempt % 3)).join("");
  return sanitizeEmployeeId(`${nameSlug}${picked}${seq}`);
}

export async function generateMemberEmployeeId(db, memberId, options = {}) {
  const [memberDocs, relDocs, roleNameById] = await Promise.all([
    listMembersPg({ limit: 5000 }),
    pgQuery("SELECT * FROM member_relationships"),
    loadRoleNameById(db),
  ]);

  const memberDataById = new Map();
  const dateAddedById = new Map();
  const takenIds = new Set();

  for (const data of memberDocs) {
    memberDataById.set(data.id, data);
    dateAddedById.set(data.id, timestampMs(data.date_added));
    if (data.id !== memberId) {
      const existing = normalizeForCompare(data.employee_id);
      if (existing) takenIds.add(existing);
    }
  }

  const targetData = memberDataById.get(memberId);
  if (!targetData) {
    throw new Error("Member not found");
  }

  const targetRoleName = roleNameById.get(typeof targetData.role_id === "string" ? targetData.role_id : "") || "User";
  const storedFirstName = typeof targetData.first_name === "string" ? targetData.first_name : "";
  const overrideFirstName = typeof options.firstName === "string" ? options.firstName.trim() : "";
  const firstName = overrideFirstName || storedFirstName;
  const lastName = typeof targetData.last_name === "string" ? targetData.last_name : "";
  const workEmail = typeof targetData.work_email === "string" ? targetData.work_email : "";
  const nameSlug = slugFromFirstName(firstName, `${firstName} ${lastName}`.trim(), workEmail);

  let edges = relDocs
    .map((row) => ({
      parent_member_id: typeof row.parent_member_id === "string" ? row.parent_member_id : "",
      child_member_id: typeof row.child_member_id === "string" ? row.child_member_id : "",
    }))
    .filter((edge) => edge.parent_member_id && edge.child_member_id);

  const ownerIds = new Set(
    [...memberDataById.entries()]
      .filter(([, data]) => isOrganizationRootRole(roleNameById.get(typeof data.role_id === "string" ? data.role_id : "") || ""))
      .map(([id]) => id),
  );
  edges = edges.filter(
    (edge) => !(ownerIds.has(edge.child_member_id) && ownerIds.has(edge.parent_member_id)),
  );

  const childToParent = new Map();
  const parentToChildren = new Map();
  const childIds = new Set();

  for (const edge of edges) {
    const parentRole = roleNameById.get(
      typeof memberDataById.get(edge.parent_member_id)?.role_id === "string"
        ? memberDataById.get(edge.parent_member_id)?.role_id
        : "",
    ) || "";
    const childRole = roleNameById.get(
      typeof memberDataById.get(edge.child_member_id)?.role_id === "string"
        ? memberDataById.get(edge.child_member_id)?.role_id
        : "",
    ) || "";
    if (isExcludedFromHierarchy(parentRole) || isExcludedFromHierarchy(childRole)) continue;
    if (!memberDataById.has(edge.parent_member_id) || !memberDataById.has(edge.child_member_id)) continue;

    childToParent.set(edge.child_member_id, edge.parent_member_id);
    const list = parentToChildren.get(edge.parent_member_id) || [];
    if (!list.includes(edge.child_member_id)) list.push(edge.child_member_id);
    parentToChildren.set(edge.parent_member_id, list);
    childIds.add(edge.child_member_id);
  }

  const sortMemberIds = (/** @type {string[]} */ ids) =>
    [...ids].sort((a, b) => {
      const byDate = (dateAddedById.get(a) ?? 0) - (dateAddedById.get(b) ?? 0);
      return byDate !== 0 ? byDate : a.localeCompare(b);
    });

  for (const [parentId, children] of parentToChildren.entries()) {
    parentToChildren.set(parentId, sortMemberIds(children));
  }

  const validRootMemberIds = [];
  const orphanMemberIds = [];

  for (const [id, data] of memberDataById.entries()) {
    const roleName = roleNameById.get(typeof data.role_id === "string" ? data.role_id : "") || "User";
    if (isExcludedFromHierarchy(roleName)) continue;

    const parentId = childToParent.get(id) ?? null;
    const placement = classifyHierarchyPlacement(roleName, parentId, data);
    if (placement === "external") continue;
    if (placement === "invalid") {
      orphanMemberIds.push(id);
    } else if (!parentId && (placement === "independent" || placement === "hierarchy_root")) {
      if (isOrganizationAdminRole(roleName)) {
        orphanMemberIds.push(id);
      } else {
        validRootMemberIds.push(id);
      }
    }
    if (isOrganizationRootRole(roleName) && !validRootMemberIds.includes(id)) {
      validRootMemberIds.push(id);
    }
  }

  const sortedRoots = sortMemberIds(validRootMemberIds);
  const metricsByMemberId = new Map();
  let treeSequence = 0;

  const walk = (nodeId, depth) => {
    if (!memberDataById.has(nodeId)) return;
    treeSequence += 1;

    const nodeRoleName = roleNameById.get(
      typeof memberDataById.get(nodeId)?.role_id === "string"
        ? memberDataById.get(nodeId)?.role_id
        : "",
    ) || "User";
    const nodeRank = rolePrivilegeRank(nodeRoleName);

    const parentId = childToParent.get(nodeId) ?? null;
    let ancestorCount = 0;
    let ancestorRoleCount = 0;
    let cursor = parentId;
    while (cursor) {
      ancestorCount += 1;
      const ancestorRole = roleNameById.get(
        typeof memberDataById.get(cursor)?.role_id === "string"
          ? memberDataById.get(cursor)?.role_id
          : "",
      ) || "User";
      if (rolePrivilegeRank(ancestorRole) > nodeRank) {
        ancestorRoleCount += 1;
      }
      cursor = childToParent.get(cursor) ?? null;
    }

    const siblingPool = parentId ? (parentToChildren.get(parentId) || []) : sortedRoots;
    const siblingIndex = Math.max(0, siblingPool.indexOf(nodeId));

    metricsByMemberId.set(nodeId, {
      treeSequence,
      depth,
      ancestorCount,
      ancestorRoleCount,
      siblingIndex,
      roleCode: rolePresenceCode(nodeRoleName),
    });

    for (const childId of parentToChildren.get(nodeId) || []) {
      walk(childId, depth + 1);
    }
  };

  for (const rootId of sortedRoots) {
    walk(rootId, 0);
  }

  let metrics = metricsByMemberId.get(memberId) || {
    treeSequence: 1,
    depth: 0,
    ancestorCount: 0,
    ancestorRoleCount: 0,
    siblingIndex: 0,
    roleCode: rolePresenceCode(targetRoleName),
  };

  if (!metricsByMemberId.has(memberId)) {
    const hierarchyMembers = [...memberDataById.entries()]
      .filter(([id, data]) => {
        const roleName = roleNameById.get(typeof data.role_id === "string" ? data.role_id : "") || "User";
        return !isExcludedFromHierarchy(roleName) && !orphanMemberIds.includes(id);
      })
      .sort((a, b) => {
        const byDate = (dateAddedById.get(a[0]) ?? 0) - (dateAddedById.get(b[0]) ?? 0);
        return byDate !== 0 ? byDate : a[0].localeCompare(b[0]);
      });
    const joinIndex = hierarchyMembers.findIndex(([id]) => id === memberId);
    metrics = {
      ...metrics,
      treeSequence: joinIndex >= 0 ? joinIndex + 1 : hierarchyMembers.length + 1,
    };
  }

  for (let attempt = 0; attempt < 250; attempt += 1) {
    const candidate = buildEmployeeIdCandidate(nameSlug, metrics, attempt, memberId);
    if (candidate.length >= MIN_EMPLOYEE_ID_LENGTH && !takenIds.has(normalizeForCompare(candidate))) {
      return {
        employeeId: candidate,
        metrics: {
          nameSlug,
          treeSequence: metrics.treeSequence,
          depth: metrics.depth,
          ancestorCount: metrics.ancestorCount,
          ancestorRoleCount: metrics.ancestorRoleCount,
          siblingIndex: metrics.siblingIndex,
          roleCode: metrics.roleCode,
        },
      };
    }
  }

  const fallback = sanitizeEmployeeId(`${nameSlug}${metrics.treeSequence}${crypto.randomBytes(2).toString("hex")}`);
  if (fallback.length >= MIN_EMPLOYEE_ID_LENGTH && !takenIds.has(normalizeForCompare(fallback))) {
    return { employeeId: fallback, metrics: { nameSlug, ...metrics } };
  }

  throw new Error("Unable to generate a unique employee ID");
}
