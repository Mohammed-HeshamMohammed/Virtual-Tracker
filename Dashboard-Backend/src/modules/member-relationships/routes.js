import { getDb } from "../../config/firebase.js";
import { getAuthContext } from "../../http/auth-context.js";
import { assertManagementRole, assertMemberAccessible, assertOrgAdminRole } from "../../http/authorization.js";
import { rejectUnknownFields } from "../../http/validate-body.js";
import { logSafeError } from "../../http/sanitize-error.js";
import { sendJson } from "../../http/response.js";
import { readJsonBody } from "../../http/read-json-body.js";
import { fetchAllDocs } from "../../lib/firestore/paginate-all.js";
import {
  recordMemberRelationship,
  getMemberAncestors,
  getMemberDescendants,
  getMemberTreePath,
  getMemberRoot,
  getConnectedMembers,
  getMembersBySharedProjects,
  getVisibleMembersForClient,
  getTeamSubtreeMemberIds,
  getVisibleMemberIds,
  getManageableMemberIds,
  getManagerPeoplePageVisibleMemberIds,
  buildMemberTree,
  isAncestorOf,
  filterTeamScopeEdges,
  repairMemberRelationshipIntegrity,
  resolveAvatarUrlsForMembers,
} from "./service.js";
import { planRelationshipRepairs, RelationshipIntegrityError } from "./relationship-integrity.js";
import { initializeMemberRelationships, forceReinitializeRelationships } from "./migrate.js";
import { maybeRepairOrphansOnTreeLoad, cleanupExternalEntityHierarchyEdges, maybeSeparateOwnersOnTreeLoad } from "../hierarchy/hierarchy-repair.js";
import { classifyHierarchyPlacement, isExcludedFromHierarchy, isOrganizationAdminRole, isOrganizationRootRole } from "../hierarchy/hierarchy-placement.js";
import { canCreateTeams } from "../../http/team-member-assign-policy.js";
import { getTeamStaffableMemberIds, getTeamStaffableMemberSummaries } from "../../http/team-edit-access.js";
import { loadRoleNameById } from "../members/services/relation-sync.js";
import { listMembersPg } from "../../lib/postgres/members-postgres.service.js";
import { query } from "../../lib/postgres/client.js";

function normalizeRole(value) {
  if (typeof value !== "string") return "";
  return value.trim().toLowerCase().replace(/\s+/g, "");
}

async function requireOrgTreeRole(req, res, origin) {
  const viewer = getAuthContext(req);
  if (!viewer) {
    sendJson(res, origin, 401, { success: false, error: "Authorization required." });
    return null;
  }

  const role = normalizeRole(viewer.roleName);
  if (role !== "superadmin" && role !== "owner" && role !== "admin") {
    sendJson(res, origin, 403, { success: false, error: "Insufficient permissions to view the organization tree." });
    return null;
  }

  return viewer;
}

async function requireTeamTreeRole(req, res, origin) {
  const viewer = getAuthContext(req);
  if (!viewer) {
    sendJson(res, origin, 401, { success: false, error: "Authorization required." });
    return null;
  }

  const role = normalizeRole(viewer.roleName);
  const orgRole = role === "superadmin" || role === "owner" || role === "admin";
  const managerRole = role === "manager" || role === "supermanager" || role === "supermanger";
  if (!orgRole && !managerRole) {
    sendJson(res, origin, 403, { success: false, error: "Insufficient permissions to view the member tree." });
    return null;
  }

  return viewer;
}

/**
 * @param {import("node:http").IncomingMessage} req
 * @param {import("node:http").ServerResponse} res
 * @param {URL} url
 * @param {string|undefined} origin
 * @returns {Promise<boolean>}
 */
export async function routeMemberRelationships(req, res, url, origin) {
  const db = getDb();
  if (!db) return false;

  const pn = url.pathname;

  // GET /api/member-relationships/scoped-members — role-aware hierarchy visibility for signed-in viewer
  if (
    (pn === "/api/member-relationships/scoped-members" || pn === "/api/v1/member-relationships/scoped-members") &&
    req.method === "GET"
  ) {
    const viewer = getAuthContext(req);
    if (!viewer) {
      sendJson(res, origin, 401, { success: false, error: "Authorization required." });
      return true;
    }
    try {
      const [visibleIds, manageableIds, teamStaffableIds] = await Promise.all([
        getVisibleMemberIds(db, viewer.memberId, viewer.roleName),
        getManageableMemberIds(db, viewer.memberId, viewer.roleName),
        canCreateTeams(viewer.roleName) ? getTeamStaffableMemberIds(db, viewer.memberId, viewer.roleName) : [],
      ]);
      sendJson(res, origin, 200, {
        success: true,
        data: {
          member_id: viewer.memberId,
          members: visibleIds,
          manageable_members: manageableIds,
          team_staffable_members: teamStaffableIds,
          sees_all: visibleIds === null,
        },
      });
    } catch (e) {
      logSafeError("[member-relationships/scoped-members]", e);
      sendJson(res, origin, 500, { success: false, error: e instanceof Error ? e.message : "Failed to resolve scoped members" });
    }
    return true;
  }

  // GET /api/member-relationships/team-staffable-members — picker rows for team create/edit
  if (
    (pn === "/api/member-relationships/team-staffable-members" ||
      pn === "/api/v1/member-relationships/team-staffable-members") &&
    req.method === "GET"
  ) {
    const viewer = getAuthContext(req);
    if (!viewer) {
      sendJson(res, origin, 401, { success: false, error: "Authorization required." });
      return true;
    }
    if (!canCreateTeams(viewer.roleName)) {
      sendJson(res, origin, 403, { success: false, error: "Insufficient permissions to staff teams." });
      return true;
    }
    try {
      const members = await getTeamStaffableMemberSummaries(db, viewer.memberId, viewer.roleName);
      sendJson(res, origin, 200, {
        success: true,
        data: {
          member_id: viewer.memberId,
          members,
          sees_all: members === null,
        },
      });
    } catch (e) {
      logSafeError("[member-relationships/team-staffable-members]", e);
      sendJson(res, origin, 500, {
        success: false,
        error: e instanceof Error ? e.message : "Failed to resolve team staffable members",
      });
    }
    return true;
  }

  // GET /api/member-relationships/visual-tree (org: Owner/SuperAdmin/Admin; team: managers+)
  if ((pn === "/api/member-relationships/visual-tree" || pn === "/api/v1/member-relationships/visual-tree") && req.method === "GET") {
    const scope = url.searchParams.get("scope") === "team" ? "team" : "organization";
    const authz = scope === "team"
      ? await requireTeamTreeRole(req, res, origin)
      : await requireOrgTreeRole(req, res, origin);
    if (!authz) return true;
    try {
      if (scope === "organization") {
        await cleanupExternalEntityHierarchyEdges(db);
        await maybeSeparateOwnersOnTreeLoad(db);
        await maybeRepairOrphansOnTreeLoad(db, authz.memberId);
      }

      let [membersRows, relDocs, roleNameById] = await Promise.all([
        listMembersPg({ limit: 5000 }),
        fetchAllDocs(db.collection("member_relationships")),
        loadRoleNameById(db),
      ]);

      const relationshipRows = relDocs.map((doc) => ({ id: doc.id, ...doc.data() }));
      if (planRelationshipRepairs(relationshipRows).remove.length > 0) {
        const repair = await repairMemberRelationshipIntegrity(db);
        if (repair.repaired) {
          relDocs = await fetchAllDocs(db.collection("member_relationships"));
        }
      }

      const includeFirebaseUid = normalizeRole(authz.roleName) === "owner";
      const memberDataById = new Map(membersRows.map((r) => [String(r.id), r]));

      let nodes = membersRows.map((d) => {
        const id = String(d.id);
        const first = typeof d.first_name === "string" ? d.first_name : "";
        const last = typeof d.last_name === "string" ? d.last_name : "";
        const name = `${first} ${last}`.trim() || (typeof d.work_email === "string" ? d.work_email : "Unnamed member");
        const roleId = typeof d.role_id === "string" ? d.role_id : "";
        return {
          id,
          name,
          email: typeof d.work_email === "string" ? d.work_email : "",
          role: roleNameById.get(roleId) || "User",
          hierarchy_status: typeof d.hierarchy_status === "string" ? d.hierarchy_status : "",
          ...(includeFirebaseUid
            ? { firebase_uid: typeof d.firebase_uid === "string" ? d.firebase_uid : "" }
            : {}),
        };
      });

      let edges = relDocs.map((doc) => {
        const d = doc.data() || {};
        return {
          id: doc.id,
          parent_member_id: typeof d.parent_member_id === "string" ? d.parent_member_id : "",
          child_member_id: typeof d.child_member_id === "string" ? d.child_member_id : "",
          relationship_type: typeof d.relationship_type === "string" ? d.relationship_type : "",
        };
      }).filter((e) => e.parent_member_id && e.child_member_id);

      const childToParent = new Map(edges.map((e) => [e.child_member_id, e.parent_member_id]));
      const orphanMemberIds = [];
      const validRootMemberIds = [];

      for (const node of nodes) {
        const parentId = childToParent.get(node.id) ?? null;
        const placement = classifyHierarchyPlacement(node.role, parentId, memberDataById.get(node.id));
        if (placement === "external") continue;
        if (placement === "invalid") {
          orphanMemberIds.push(node.id);
        } else if (!parentId && (placement === "independent" || placement === "hierarchy_root")) {
          if (isOrganizationAdminRole(node.role)) {
            orphanMemberIds.push(node.id);
          } else {
            validRootMemberIds.push(node.id);
          }
        }
        if (isOrganizationRootRole(node.role) && !validRootMemberIds.includes(node.id)) {
          validRootMemberIds.push(node.id);
        }
      }

      const ownerIds = new Set(
        nodes.filter((n) => isOrganizationRootRole(n.role)).map((n) => n.id),
      );
      edges = edges.filter(
        (e) => !(ownerIds.has(e.child_member_id) && ownerIds.has(e.parent_member_id)),
      );

      nodes = nodes.filter((n) => !isExcludedFromHierarchy(n.role));
      const visibleIds = new Set(nodes.map((n) => n.id));
      edges = edges.filter(
        (e) => visibleIds.has(e.parent_member_id) && visibleIds.has(e.child_member_id),
      );

      if (scope === "team") {
        const [visibleIds, ancestors] = await Promise.all([
          getManagerPeoplePageVisibleMemberIds(db, authz.memberId),
          getMemberAncestors(db, authz.memberId),
        ]);
        const allowed = new Set(visibleIds);
        nodes = nodes.filter((n) => allowed.has(n.id));
        edges = edges.filter(
          (e) => allowed.has(e.parent_member_id) && allowed.has(e.child_member_id),
        );
        const ownerAncestor = ancestors.find((a) => {
          const node = nodes.find((n) => n.id === a.member_id);
          return node?.role && isOrganizationRootRole(node.role);
        });
        const branchRootId =
          ownerAncestor?.member_id ||
          (ancestors.length ? ancestors[0].member_id : authz.memberId);
        edges = filterTeamScopeEdges(branchRootId, edges);
      }

      const avatarByMemberId = await resolveAvatarUrlsForMembers(db, { docs: membersDocs });
      nodes = nodes.map((node) => {
        const avatarUrl = avatarByMemberId.get(node.id);
        return avatarUrl ? { ...node, avatar_url: avatarUrl } : node;
      });

      sendJson(res, origin, 200, {
        success: true,
        data: {
          nodes,
          edges,
          scope,
          orphan_member_ids: orphanMemberIds,
          valid_root_member_ids: validRootMemberIds,
        },
      });
    } catch (e) {
      logSafeError("[member-relationships/visual-tree]", e);
      sendJson(res, origin, 500, { success: false, error: e instanceof Error ? e.message : "Failed to build visual tree" });
    }
    return true;
  }

  // GET /api/member-relationships/:memberId/ancestors
  const ancestorsMatch = pn.match(/^\/api(?:\/v1)?\/member-relationships\/([^/]+)\/ancestors$/);
  if (ancestorsMatch && req.method === "GET") {
    const memberId = ancestorsMatch[1];
    if (!(await assertMemberAccessible(req, res, origin, db, memberId))) return true;
    try {
      const ancestors = await getMemberAncestors(db, memberId);
      sendJson(res, origin, 200, { success: true, data: ancestors });
    } catch (e) {
      logSafeError("[member-relationships/ancestors]", e);
      sendJson(res, origin, 500, { success: false, error: e.message });
    }
    return true;
  }

  // GET /api/member-relationships/:memberId/descendants
  const descendantsMatch = pn.match(/^\/api(?:\/v1)?\/member-relationships\/([^/]+)\/descendants$/);
  if (descendantsMatch && req.method === "GET") {
    const memberId = descendantsMatch[1];
    if (!(await assertMemberAccessible(req, res, origin, db, memberId))) return true;
    const maxDepth = parseInt(url.searchParams.get("maxDepth") || "10", 10);
    try {
      const descendants = await getMemberDescendants(db, memberId, maxDepth);
      sendJson(res, origin, 200, { success: true, data: descendants });
    } catch (e) {
      logSafeError("[member-relationships/descendants]", e);
      sendJson(res, origin, 500, { success: false, error: e.message });
    }
    return true;
  }

  // GET /api/member-relationships/:memberId/tree-path
  const pathMatch = pn.match(/^\/api(?:\/v1)?\/member-relationships\/([^/]+)\/tree-path$/);
  if (pathMatch && req.method === "GET") {
    const memberId = pathMatch[1];
    if (!(await assertMemberAccessible(req, res, origin, db, memberId))) return true;
    try {
      const path = await getMemberTreePath(db, memberId);
      sendJson(res, origin, 200, { success: true, data: path });
    } catch (e) {
      logSafeError("[member-relationships/tree-path]", e);
      sendJson(res, origin, 500, { success: false, error: e.message });
    }
    return true;
  }

  // GET /api/member-relationships/:memberId/root
  const rootMatch = pn.match(/^\/api(?:\/v1)?\/member-relationships\/([^/]+)\/root$/);
  if (rootMatch && req.method === "GET") {
    const memberId = rootMatch[1];
    if (!(await assertMemberAccessible(req, res, origin, db, memberId))) return true;
    try {
      const rootId = await getMemberRoot(db, memberId);
      sendJson(res, origin, 200, { success: true, data: { root_id: rootId } });
    } catch (e) {
      logSafeError("[member-relationships/root]", e);
      sendJson(res, origin, 500, { success: false, error: e.message });
    }
    return true;
  }

  // GET /api/member-relationships/:memberId/team-subtree - Self + descendants (manager team scope)
  const teamSubtreeMatch = pn.match(/^\/api(?:\/v1)?\/member-relationships\/([^/]+)\/team-subtree$/);
  if (teamSubtreeMatch && req.method === "GET") {
    const memberId = teamSubtreeMatch[1];
    if (!(await assertMemberAccessible(req, res, origin, db, memberId))) return true;
    try {
      const members = await getTeamSubtreeMemberIds(db, memberId);
      sendJson(res, origin, 200, { success: true, data: { member_id: memberId, members } });
    } catch (e) {
      logSafeError("[member-relationships/team-subtree]", e);
      sendJson(res, origin, 500, { success: false, error: e.message });
    }
    return true;
  }

  // GET /api/member-relationships/:memberId/connected
  const connectedMatch = pn.match(/^\/api(?:\/v1)?\/member-relationships\/([^/]+)\/connected$/);
  if (connectedMatch && req.method === "GET") {
    const memberId = connectedMatch[1];
    if (!(await assertMemberAccessible(req, res, origin, db, memberId))) return true;
    try {
      const connected = await getConnectedMembers(db, memberId);
      sendJson(res, origin, 200, { success: true, data: connected });
    } catch (e) {
      logSafeError("[member-relationships/connected]", e);
      sendJson(res, origin, 500, { success: false, error: e.message });
    }
    return true;
  }

  // GET /api/member-relationships/:memberId/shared-projects - Get members who share projects
  const sharedProjectsMatch = pn.match(/^\/api(?:\/v1)?\/member-relationships\/([^/]+)\/shared-projects$/);
  if (sharedProjectsMatch && req.method === "GET") {
    const memberId = sharedProjectsMatch[1];
    if (!(await assertMemberAccessible(req, res, origin, db, memberId))) return true;
    try {
      const members = await getMembersBySharedProjects(db, memberId);
      sendJson(res, origin, 200, { success: true, data: { members } });
    } catch (e) {
      logSafeError("[member-relationships/shared-projects]", e);
      sendJson(res, origin, 500, { success: false, error: e.message });
    }
    return true;
  }

  // GET /api/member-relationships/:memberId/visible - Get all visible members (tree + projects)
  const visibleMatch = pn.match(/^\/api(?:\/v1)?\/member-relationships\/([^/]+)\/visible$/);
  if (visibleMatch && req.method === "GET") {
    const memberId = visibleMatch[1];
    if (!(await assertMemberAccessible(req, res, origin, db, memberId))) return true;
    try {
      const visible = await getVisibleMembersForClient(db, memberId);
      sendJson(res, origin, 200, { success: true, data: visible });
    } catch (e) {
      logSafeError("[member-relationships/visible]", e);
      sendJson(res, origin, 500, { success: false, error: e.message });
    }
    return true;
  }

  // GET /api/member-relationships/:memberId/tree
  const treeMatch = pn.match(/^\/api(?:\/v1)?\/member-relationships\/([^/]+)\/tree$/);
  if (treeMatch && req.method === "GET") {
    const memberId = treeMatch[1];
    if (!(await assertMemberAccessible(req, res, origin, db, memberId))) return true;
    try {
      const tree = await buildMemberTree(db, memberId);
      sendJson(res, origin, 200, { success: true, data: tree });
    } catch (e) {
      logSafeError("[member-relationships/tree]", e);
      sendJson(res, origin, 500, { success: false, error: e.message });
    }
    return true;
  }

  // GET /api/member-relationships/check-ancestor?ancestor=:id&descendant=:id
  if ((pn === "/api/member-relationships/check-ancestor" || pn === "/api/v1/member-relationships/check-ancestor") && req.method === "GET") {
    const ancestorId = url.searchParams.get("ancestor");
    const descendantId = url.searchParams.get("descendant");
    if (!ancestorId || !descendantId) {
      sendJson(res, origin, 400, { success: false, error: "ancestor and descendant params required" });
      return true;
    }
    if (!(await assertMemberAccessible(req, res, origin, db, ancestorId))) return true;
    if (!(await assertMemberAccessible(req, res, origin, db, descendantId))) return true;
    try {
      const isAncestor = await isAncestorOf(db, ancestorId, descendantId);
      sendJson(res, origin, 200, { success: true, data: { is_ancestor: isAncestor } });
    } catch (e) {
      logSafeError("[member-relationships/check-ancestor]", e);
      sendJson(res, origin, 500, { success: false, error: e.message });
    }
    return true;
  }

  // POST /api/member-relationships - Manually create a relationship
  if ((pn === "/api/member-relationships" || pn === "/api/v1/member-relationships") && req.method === "POST") {
    if (!assertManagementRole(req, res, origin)) return true;
    let body;
    try {
      body = await readJsonBody(req);
      rejectUnknownFields(body, ["parent_member_id", "child_member_id", "relationship_type", "created_by"]);
    } catch (e) {
      sendJson(res, origin, 400, { success: false, error: e.message });
      return true;
    }

    const { parent_member_id, child_member_id, relationship_type } = body;
    const viewer = getAuthContext(req);

    if (!parent_member_id || !child_member_id || !relationship_type) {
      sendJson(res, origin, 400, {
        success: false,
        error: "parent_member_id, child_member_id, and relationship_type are required",
      });
      return true;
    }

    try {
      if (!(await assertMemberAccessible(req, res, origin, db, parent_member_id))) return true;
      if (!(await assertMemberAccessible(req, res, origin, db, child_member_id))) return true;
      const relationship = await recordMemberRelationship(db, {
        parentMemberId: parent_member_id,
        childMemberId: child_member_id,
        relationshipType: relationship_type,
        createdBy: viewer?.memberId || parent_member_id,
      });
      sendJson(res, origin, 201, { success: true, data: relationship });
    } catch (e) {
      if (e instanceof RelationshipIntegrityError) {
        sendJson(res, origin, 400, { success: false, error: e.message, code: e.code });
        return true;
      }
      logSafeError("[member-relationships/create]", e);
      sendJson(res, origin, 500, { success: false, error: e.message });
    }
    return true;
  }

  // GET /api/member-relationships/:memberId/parent
  const parentMatch = pn.match(/^\/api(?:\/v1)?\/member-relationships\/([^/]+)\/parent$/);
  if (parentMatch && req.method === "GET") {
    const memberId = parentMatch[1];
    if (!(await assertMemberAccessible(req, res, origin, db, memberId))) return true;
    try {
      const ancestors = await getMemberAncestors(db, memberId);
      const directParent = ancestors.length > 0 ? ancestors[ancestors.length - 1] : null;
      sendJson(res, origin, 200, { success: true, data: directParent });
    } catch (e) {
      logSafeError("[member-relationships/parent]", e);
      sendJson(res, origin, 500, { success: false, error: e.message });
    }
    return true;
  }

  // GET /api/member-relationships/:memberId/children
  const childrenMatch = pn.match(/^\/api(?:\/v1)?\/member-relationships\/([^/]+)\/children$/);
  if (childrenMatch && req.method === "GET") {
    const memberId = childrenMatch[1];
    if (!(await assertMemberAccessible(req, res, origin, db, memberId))) return true;
    try {
      const descendants = await getMemberDescendants(db, memberId, 1); // Only direct children
      sendJson(res, origin, 200, { success: true, data: descendants });
    } catch (e) {
      logSafeError("[member-relationships/children]", e);
      sendJson(res, origin, 500, { success: false, error: e.message });
    }
    return true;
  }

  // POST /api/member-relationships/initialize - Auto-create relationships from existing members
  if ((pn === "/api/member-relationships/initialize" || pn === "/api/v1/member-relationships/initialize") && req.method === "POST") {
    if (!assertManagementRole(req, res, origin)) return true;
    try {
      const result = await initializeMemberRelationships();
      sendJson(res, origin, result.success ? 200 : 503, result);
    } catch (e) {
      logSafeError("[member-relationships/initialize]", e);
      sendJson(res, origin, 500, { success: false, error: e.message });
    }
    return true;
  }

  // POST /api/member-relationships/reinitialize - Force re-initialization (admin only)
  if ((pn === "/api/member-relationships/reinitialize" || pn === "/api/v1/member-relationships/reinitialize") && req.method === "POST") {
    if (!assertOrgAdminRole(req, res, origin)) return true;
    try {
      const result = await forceReinitializeRelationships();
      sendJson(res, origin, result.success ? 200 : 503, result);
    } catch (e) {
      logSafeError("[member-relationships/reinitialize]", e);
      sendJson(res, origin, 500, { success: false, error: e.message });
    }
    return true;
  }

  // GET /api/member-relationships/status - Check migration status
  if ((pn === "/api/member-relationships/status" || pn === "/api/v1/member-relationships/status") && req.method === "GET") {
    if (!assertManagementRole(req, res, origin)) return true;
    try {
      const existingRel = await db.collection("member_relationships").limit(1).get();
      const countResult = await query("SELECT COUNT(*)::int as count FROM members");
      const memberCount = countResult[0]?.count ?? 0;

      sendJson(res, origin, 200, {
        success: true,
        data: {
          initialized: !existingRel.empty,
          relationships_exist: !existingRel.empty,
          member_count: memberCount,
        },
      });
    } catch (e) {
      logSafeError("[member-relationships/status]", e);
      sendJson(res, origin, 500, { success: false, error: e.message });
    }
    return true;
  }

  return false;
}
