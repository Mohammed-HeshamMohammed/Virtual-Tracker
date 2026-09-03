import crypto from "node:crypto";
import { logSafeWarn } from "../http/sanitize-error.js";
import { isPostgresLookupReady, resetPostgresLookupReadyCache } from "../lib/postgres/lookup-availability.js";
import {
  seedLookupTablePostgresIfEmpty,
  seedOrgFieldOptionsPostgresIfEmpty,
} from "../lib/postgres/lookup-postgres.service.js";
import { initializeMemberRelationships } from "../modules/member-relationships/migrate.js";
import { ensureUserProfileImageFields } from "../modules/auth/migrate-profile-image-fields.js";
import { ensureMemberScopedEntities } from "../modules/members/services/member-entity-bootstrap.js";
import { ensureDefaultRoles } from "../modules/members/services/relation-sync.js";
import {
  ENTITY_BOOTSTRAP_VERSION,
  ORG_FIELD_OPTION_SEEDS,
  ORG_LOOKUP_SEEDS,
} from "./entity-bootstrap-manifest.js";
import { getSystemMetaDoc, setSystemMetaDoc } from "../lib/postgres/member-data-store.js";

const ENTITY_BOOTSTRAP_META_KEY = "entity_bootstrap";

export async function ensureOrganizationEntities(db, actor = "system", options = {}) {
  const created = [];

  await ensureDefaultRoles(db);
  created.push("roles");

  await isPostgresLookupReady();
  for (const [collection, names] of Object.entries(ORG_LOOKUP_SEEDS)) {
    const seeded = await seedLookupTablePostgresIfEmpty(collection, names, actor);
    created.push(...seeded);
  }

  for (const [type, labels] of Object.entries(ORG_FIELD_OPTION_SEEDS)) {
    const seeded = await seedOrgFieldOptionsPostgresIfEmpty(type, labels);
    created.push(...seeded);
  }

  await setSystemMetaDoc(db, ENTITY_BOOTSTRAP_META_KEY, {
    complete: true,
    version: ENTITY_BOOTSTRAP_VERSION,
    updated_at: new Date(),
    updated_by: actor,
  });
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

let maintenanceInFlight = null;

async function isOrganizationMaintenanceComplete(db) {
  const meta = await getSystemMetaDoc(db, ENTITY_BOOTSTRAP_META_KEY);
  return meta?.maintenanceComplete === true;
}

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

  await setSystemMetaDoc(db, ENTITY_BOOTSTRAP_META_KEY, {
    maintenanceComplete: true,
    maintenance_version: ENTITY_BOOTSTRAP_VERSION,
    maintenance_at: new Date(),
    maintenance_by: actor,
  });
  created.push("system_meta:entity_maintenance");

  return { created: [...new Set(created)] };
}

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
