import crypto from "node:crypto";
import { logSafeWarn } from "../http/sanitize-error.js";
import { isPostgresLookupReady, resetPostgresLookupReadyCache } from "../lib/postgres/lookup-availability.js";
import {
  seedLookupTablePostgresIfEmpty,
  seedOrgFieldOptionsPostgresIfEmpty,
} from "../lib/postgres/lookup-postgres.service.js";
import { initializeMemberRelationships } from "../modules/member-relationships/migrate.js";
import { ensureUserProfileImageFields } from "../modules/auth/migrate-profile-image-fields.js";
import { removeClientBudgetStartDates } from "../modules/clients/migrate-remove-budget-start-date.js";
import { ensureMemberScopedEntities } from "../modules/members/services/member-entity-bootstrap.js";
import { normalizeLegacyMemberDocumentIds } from "../modules/members/services/normalize-member-doc-ids.js";
import { ensureDefaultRoles } from "../modules/members/services/relation-sync.js";
import {
  ENTITY_BOOTSTRAP_META_DOC,
  ENTITY_BOOTSTRAP_VERSION,
  ORG_FIELD_OPTION_SEEDS,
  ORG_LOOKUP_SEEDS,
} from "./entity-bootstrap-manifest.js";

/**
 * @param {import("firebase-admin/firestore").Firestore} db
 * @param {string} collection
 * @param {string[]} names
 * @param {string} actor
 */
async function seedLookupTableIfEmpty(db, collection, names, actor) {
  const snap = await db.collection(collection).limit(1).get();
  if (!snap.empty) return [];

  const created = [];
  const now = new Date();
  for (let i = 0; i < names.length; i++) {
    const id = crypto.randomUUID();
    await db.collection(collection).doc(id).set({
      id,
      name: names[i],
      list_ranking: String(i),
      created_at: now,
      created_by: actor,
      updated_by: actor,
    });
    created.push(collection);
  }
  return created;
}

/**
 * @param {import("firebase-admin/firestore").Firestore} db
 * @param {string} type
 * @param {string[]} labels
 */
async function seedOrgFieldOptionsIfEmpty(db, type, labels) {
  const snap = await db.collection("members_field_data").where("type", "==", type).limit(1).get();
  if (!snap.empty) return [];

  const created = [];
  const now = new Date();
  for (let i = 0; i < labels.length; i++) {
    const ref = db.collection("members_field_data").doc();
    await ref.set({
      type,
      recordType: type,
      label: labels[i],
      position: i,
      created_at: now,
    });
    created.push(`members_field_data:${type}`);
  }
  return created;
}

/**
 * Organization-wide bootstrap: roles, employment lookups, org field options,
 * relationship tree init, legacy ID migration marker, system_meta.
 *
 * Heavy maintenance (relationship scans, profile image migration) can be deferred
 * off the auth verify critical path — see scheduleOrganizationMaintenance.
 *
 * @param {import("firebase-admin/firestore").Firestore} db
 * @param {string} [actor]
 * @param {{ deferMaintenance?: boolean }} [options]
 * @returns {Promise<{ created: string[], skipped?: string, deferred?: boolean }>}
 */
export async function ensureOrganizationEntities(db, actor = "system", options = {}) {
  const created = [];

  await ensureDefaultRoles(db);
  created.push("roles");

  let usedPostgresLookups = false;
  if (await isPostgresLookupReady()) {
    try {
      for (const [collection, names] of Object.entries(ORG_LOOKUP_SEEDS)) {
        const seeded = await seedLookupTablePostgresIfEmpty(collection, names, actor);
        created.push(...seeded);
      }

      for (const [type, labels] of Object.entries(ORG_FIELD_OPTION_SEEDS)) {
        const seeded = await seedOrgFieldOptionsPostgresIfEmpty(type, labels);
        created.push(...seeded);
      }
      usedPostgresLookups = true;
    } catch (err) {
      logSafeWarn("[entity-bootstrap] Postgres lookup seed failed; using Firestore:", err);
      resetPostgresLookupReadyCache();
    }
  }

  if (!usedPostgresLookups) {
    for (const [collection, names] of Object.entries(ORG_LOOKUP_SEEDS)) {
      const seeded = await seedLookupTableIfEmpty(db, collection, names, actor);
      created.push(...seeded);
    }

    for (const [type, labels] of Object.entries(ORG_FIELD_OPTION_SEEDS)) {
      const seeded = await seedOrgFieldOptionsIfEmpty(db, type, labels);
      created.push(...seeded);
    }
  }

  await db.doc(ENTITY_BOOTSTRAP_META_DOC).set(
    {
      complete: true,
      version: ENTITY_BOOTSTRAP_VERSION,
      updated_at: new Date(),
      updated_by: actor,
    },
    { merge: true },
  );
  created.push("system_meta:entity_bootstrap");

  if (await isOrganizationMaintenanceComplete(db)) {
    const unique = [...new Set(created)];
    return { created: unique, skipped: "maintenance_already_complete" };
  }

  if (options.deferMaintenance) {
    scheduleOrganizationMaintenance(db, actor);
    const unique = [...new Set(created)];
    return { created: unique, deferred: true };
  }

  const maintenance = await runOrganizationMaintenance(db, actor);
  created.push(...maintenance.created);

  const unique = [...new Set(created)];
  return { created: unique };
}

/** @type {Promise<unknown> | null} */
let maintenanceInFlight = null;

/**
 * @param {import("firebase-admin/firestore").Firestore} db
 */
async function isOrganizationMaintenanceComplete(db) {
  const snap = await db.doc(ENTITY_BOOTSTRAP_META_DOC).get();
  return snap.exists && snap.data()?.maintenanceComplete === true;
}

/**
 * Run heavy org migrations off the login critical path (single-flight per process).
 *
 * @param {import("firebase-admin/firestore").Firestore} db
 * @param {string} [actor]
 */
export function scheduleOrganizationMaintenance(db, actor = "system") {
  if (maintenanceInFlight) return maintenanceInFlight;
  maintenanceInFlight = runOrganizationMaintenance(db, actor)
    .catch((err) => {
      logSafeWarn("[entity-bootstrap] deferred maintenance failed:", err);
      return { created: [], failed: true };
    })
    .finally(() => {
      maintenanceInFlight = null;
    });
  return maintenanceInFlight;
}

/**
 * @param {import("firebase-admin/firestore").Firestore} db
 * @param {string} actor
 * @returns {Promise<{ created: string[] }>}
 */
async function runOrganizationMaintenance(db, actor) {
  if (await isOrganizationMaintenanceComplete(db)) {
    return { created: [] };
  }

  const created = [];

  try {
    const rel = await initializeMemberRelationships();
    if (rel.relationshipsCreated > 0) {
      created.push("member_relationships");
    }
  } catch (err) {
    logSafeWarn("[entity-bootstrap] member relationships init failed:", err);
  }

  try {
    const { repairMemberRelationshipIntegrity } = await import("../modules/member-relationships/service.js");
    const repair = await repairMemberRelationshipIntegrity(db);
    if (repair.repaired) {
      created.push("member_relationships_integrity_repair");
    }
  } catch (err) {
    logSafeWarn("[entity-bootstrap] member relationships integrity repair failed:", err);
  }

  try {
    const profileImages = await ensureUserProfileImageFields();
    if (profileImages.updated > 0) {
      created.push("User_profiles:profile_image_fields");
    }
  } catch (err) {
    logSafeWarn("[entity-bootstrap] user profile image field migration failed:", err);
  }

  try {
    const budgetStartDates = await removeClientBudgetStartDates();
    if (budgetStartDates.updated > 0) {
      created.push("client_budgets:start_date_removed");
    }
  } catch (err) {
    logSafeWarn("[entity-bootstrap] client budget start date migration failed:", err);
  }

  try {
    const migration = await normalizeLegacyMemberDocumentIds(db);
    if (migration.migrated > 0) created.push("system_meta:member_document_ids");
  } catch (err) {
    logSafeWarn("[entity-bootstrap] member id normalization failed:", err);
  }

  await db.doc(ENTITY_BOOTSTRAP_META_DOC).set(
    {
      maintenanceComplete: true,
      maintenance_version: ENTITY_BOOTSTRAP_VERSION,
      maintenance_at: new Date(),
      maintenance_by: actor,
    },
    { merge: true },
  );
  created.push("system_meta:entity_maintenance");

  return { created: [...new Set(created)] };
}

/**
 * Full diagram bootstrap for an authenticated user: org layer + member profile layer.
 *
 * @param {import("firebase-admin/firestore").Firestore} db
 * @param {import("firebase-admin/auth").UserRecord} userRecord
 * @param {{ memberId: string, memberData?: Record<string, unknown> }} memberCtx
 * @returns {Promise<{ org: { created: string[] }, member: { created: string[] } }>}
 */
export async function ensureEntityDiagramForAuthUser(db, userRecord, memberCtx) {
  const actor = userRecord.uid || "auth-auto-init";
  const org = await ensureOrganizationEntities(db, actor, { deferMaintenance: true });
  const member = await ensureMemberScopedEntities(db, {
    memberId: memberCtx.memberId,
    memberData: memberCtx.memberData || {},
    actor,
    skipOnboardingForOwner: true,
  });
  return { org, member };
}
