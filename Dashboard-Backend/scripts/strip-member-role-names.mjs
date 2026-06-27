/**
 * Migrates legacy role data from root collections (member_roles/members_roles),
 * sub-collections under `members`, and legacy fields in `members` documents,
 * writes assignments to the member documents directly via `role_id`, and then purges
 * the legacy collections, sub-collections, and fields.
 *
 * Usage:
 *   npm run migrate:strip-role-names
 *   npm run migrate:strip-role-names -- --dry-run
 */

import crypto from "node:crypto";
import { FieldValue } from "firebase-admin/firestore";
import { getDb } from "../src/config/firebase.js";
import { 
  resolveRoleIdByName, 
  resolveRoleNameById, 
  pickHighestPrivilegeRoleName 
} from "../src/modules/members/services/relation-sync.js";
import { deactivationGovernanceForRole } from "../src/http/role-hierarchy.js";

const BATCH_LIMIT = 400;

function hasDryRunFlag() {
  return process.argv.includes("--dry-run");
}

async function main() {
  const dryRun = hasDryRunFlag();
  const db = getDb();
  if (!db) {
    console.error(
      "Firebase Admin is not configured. Add firebase-admin.local.json or service account env vars in Backend/.env.",
    );
    process.exit(1);
  }

  console.log(`Starting role migration. Dry Run: ${dryRun}`);

  // 1. Fetch roles to build role name map
  const rolesSnap = await db.collection("roles").limit(100).get();
  const roleNameById = new Map(
    rolesSnap.docs.map((doc) => {
      const row = doc.data() || {};
      return [doc.id, typeof row.name === "string" ? row.name.trim() : ""];
    }),
  );

  // 2. Fetch all mappings from root member_roles and members_roles collections
  const rootMrSnap = await db.collection("member_roles").get();
  const rootMrsSnap = await db.collection("members_roles").get();

  console.log(`Sampled ${rootMrSnap.size} docs from root member_roles`);
  console.log(`Sampled ${rootMrsSnap.size} docs from root members_roles`);

  // Map of memberId -> Set of roleNames from root mappings
  const rootMappings = new Map();

  const processRootMappings = (snap) => {
    for (const doc of snap.docs) {
      const row = doc.data() || {};
      const memberId = typeof row.member_id === "string" ? row.member_id.trim() : "";
      const roleId = typeof row.role_id === "string" ? row.role_id.trim() : "";
      if (memberId && roleId) {
        const roleName = roleNameById.get(roleId);
        if (roleName) {
          if (!rootMappings.has(memberId)) {
            rootMappings.set(memberId, new Set());
          }
          rootMappings.get(memberId).add(roleName);
        }
      }
    }
  };

  processRootMappings(rootMrSnap);
  processRootMappings(rootMrsSnap);

  // 3. Process each member document
  const membersSnap = await db.collection("members").get();
  let scanned = 0;
  let updatedDocs = 0;
  let backfilledRoleId = 0;
  let subCollectionsCleaned = 0;
  let subDocsMigrated = 0;
  let rootDocsPurged = 0;

  let batch = db.batch();
  let batchCount = 0;

  const commitBatchIfNeeded = async (force = false) => {
    if (batchCount > 0 && (force || batchCount >= BATCH_LIMIT)) {
      if (!dryRun) {
        await batch.commit();
      }
      batch = db.batch();
      batchCount = 0;
    }
  };

  for (const doc of membersSnap.docs) {
    scanned += 1;
    const memberId = doc.id;
    const data = doc.data() || {};

    const candidates = [];
    const subDocsToDelete = [];

    // Gather from root mappings
    const fromRoot = rootMappings.get(memberId);
    if (fromRoot) {
      for (const name of fromRoot) {
        candidates.push(name);
      }
    }

    // Fetch sub-collections under the member document
    const rolesSubSnap = await db.collection("members").doc(memberId).collection("roles").get();
    const mrSubSnap = await db.collection("members").doc(memberId).collection("member_roles").get();
    const mrsSubSnap = await db.collection("members").doc(memberId).collection("members_roles").get();

    // Process roles sub-collection
    for (const subDoc of rolesSubSnap.docs) {
      const subData = subDoc.data() || {};
      const name = typeof subData.name === "string" ? subData.name.trim() : "";
      if (name) {
        candidates.push(name);
        subDocsMigrated += 1;
      }
      subDocsToDelete.push(subDoc.ref);
    }

    // Process member_roles & members_roles sub-collections under the member document
    const processSubmrSnap = async (subSnap) => {
      for (const subDoc of subSnap.docs) {
        const subData = subDoc.data() || {};
        const subRoleId = typeof subData.role_id === "string" ? subData.role_id.trim() : "";
        if (subRoleId) {
          const name = roleNameById.get(subRoleId) || await resolveRoleNameById(db, subRoleId);
          if (name) {
            candidates.push(name);
            subDocsMigrated += 1;
          }
        }
        subDocsToDelete.push(subDoc.ref);
      }
    };

    await processSubmrSnap(mrSubSnap);
    await processSubmrSnap(mrsSubSnap);

    // Process legacy fields on the parent doc
    const fieldsToCheck = ["role_name", "role", "roles", "member_roles", "members_roles"];
    let currentRoleId = typeof data.role_id === "string" ? data.role_id.trim() : "";

    // Parse values from parent doc legacy fields
    if (Object.prototype.hasOwnProperty.call(data, "role_name") && typeof data.role_name === "string") {
      candidates.push(data.role_name);
    }
    if (Object.prototype.hasOwnProperty.call(data, "role") && typeof data.role === "string") {
      candidates.push(data.role);
    }
    if (Array.isArray(data.roles)) {
      for (const r of data.roles) {
        if (typeof r === "string") {
          candidates.push(r);
        } else if (r && typeof r === "object") {
          if (typeof r.name === "string") candidates.push(r.name);
          if (typeof r.role_name === "string") candidates.push(r.role_name);
        }
      }
    }

    // Include existing valid role if it exists
    if (currentRoleId) {
      const currentRoleName = roleNameById.get(currentRoleId);
      if (currentRoleName) candidates.push(currentRoleName);
    }

    // Resolve highest privilege role name
    let finalRoleName = "Viewer"; // fallback default
    if (candidates.length > 0) {
      finalRoleName = pickHighestPrivilegeRoleName(candidates);
    } else if (currentRoleId) {
      // If we only have currentRoleId but it resolved to nothing in candidates
      const currentRoleName = roleNameById.get(currentRoleId);
      if (currentRoleName) finalRoleName = currentRoleName;
    }

    // Get role ID for the final name
    const finalRoleId = await resolveRoleIdByName(db, finalRoleName);

    const updates = {};

    // Check if we need to update/backfill role_id
    if (currentRoleId !== finalRoleId) {
      updates.role_id = finalRoleId;
      updates.deactivation_governance = deactivationGovernanceForRole(finalRoleName);
      updates.updated_at = new Date();
      updates.updated_by = "migration-align";
      backfilledRoleId += 1;
    }

    // Mark parent doc legacy fields for deletion
    for (const field of fieldsToCheck) {
      if (Object.prototype.hasOwnProperty.call(data, field)) {
        updates[field] = FieldValue.delete();
      }
    }

    // Queue updates for parent document
    if (Object.keys(updates).length > 0) {
      updatedDocs += 1;
      if (!dryRun) {
        batch.update(doc.ref, updates);
        batchCount += 1;
        await commitBatchIfNeeded();
      }
    }

    // Delete sub-collection documents
    if (subDocsToDelete.length > 0) {
      subCollectionsCleaned += 1;
      for (const ref of subDocsToDelete) {
        if (!dryRun) {
          batch.delete(ref);
          batchCount += 1;
          await commitBatchIfNeeded();
        }
      }
    }
  }

  // 4. Purge all root member_roles and members_roles documents
  const purgeRootCollection = async (snap) => {
    for (const doc of snap.docs) {
      rootDocsPurged += 1;
      if (!dryRun) {
        batch.delete(doc.ref);
        batchCount += 1;
        await commitBatchIfNeeded();
      }
    }
  };

  await purgeRootCollection(rootMrSnap);
  await purgeRootCollection(rootMrsSnap);

  // Final commit for leftover batch ops
  await commitBatchIfNeeded(true);

  console.info(
    JSON.stringify(
      {
        ok: true,
        dryRun,
        scanned,
        updatedDocs,
        backfilledRoleId,
        subDocsMigrated,
        subCollectionsCleaned,
        rootDocsPurged,
      },
      null,
      2,
    ),
  );
}

main().catch((err) => {
  console.error("[migrate:strip-role-names]", err instanceof Error ? err.message : err);
  process.exit(1);
});
