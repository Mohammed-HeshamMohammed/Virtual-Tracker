import { FieldPath } from "firebase-admin/firestore";
import { getDb, getAuthAdmin } from "../../../config/firebase.js";
import { requireAuthContext } from "../../../http/auth-context.js";
import { assertMigrationManagementRole } from "../../../http/member-migration-policy.js";
import { readJsonBody } from "../../../http/read-json-body.js";
import { rejectUnknownFields } from "../../../http/validate-body.js";
import { sendJson } from "../../../http/response.js";
import { logSafeError, logSafeWarn } from "../../../http/sanitize-error.js";
import { validateRoleAssignment } from "../../../http/role-assignment-guard.js";
import { resolveRoleIdByName } from "../services/relation-sync.js";
import { assertMemberNotBanned } from "../services/member-ban-service.js";
import { promotePendingMemberCore } from "./member-invites.routes.js";

const PENDING_AUTH = "pending_auth_members";
const MEMBER_AUTH_INDEX = "member_auth_index";
const MOBILE_USERS_COLLECTION = "users";
const MAX_MIGRATE_BATCH = 100;
const MIGRATABLE_PAGE_SIZE = 1000;
/** Firestore `in` queries on document id are capped at 30 values per request. */
const FIRESTORE_IN_CHUNK_SIZE = 30;

/** Mobile-app `users/{uid}.role` (lowercased, spaces/underscores collapsed) → app role label. */
const MOBILE_ROLE_MAP = {
  agent: "Employee L1",
  candidate: "Employee L0",
  manager: "Manager",
  supermanager: "Super Manager",
  client: "Client",
};

function normalizeMobileRoleKey(role) {
  return String(role || "").trim().toLowerCase().replace(/[\s_]+/g, "");
}

/** @returns {string|undefined} Suggested app role label, or undefined when the mobile role has no mapping. */
function mapMobileRoleToMemberRole(rawRole) {
  return MOBILE_ROLE_MAP[normalizeMobileRoleKey(rawRole)];
}

function normalizePathname(pathname) {
  return pathname.replace(/^\/api\/v1\//, "/api/");
}

function chunk(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

/**
 * Batch-read mobile-app profile docs (`users/{uid}`) for the given uids.
 * @param {import("firebase-admin/firestore").Firestore} db
 * @param {string[]} uids
 * @returns {Promise<Map<string, { avatarUrl: string, role: string, isActive: boolean }>>}
 */
async function fetchMobileProfiles(db, uids) {
  const profiles = new Map();
  if (uids.length === 0) return profiles;
  const groups = chunk(uids, FIRESTORE_IN_CHUNK_SIZE);
  const snapshots = await Promise.all(
    groups.map((group) =>
      db.collection(MOBILE_USERS_COLLECTION).where(FieldPath.documentId(), "in", group).get(),
    ),
  );
  for (const snap of snapshots) {
    for (const doc of snap.docs) {
      const data = doc.data() || {};
      profiles.set(doc.id, {
        avatarUrl: typeof data.avatarUrl === "string" ? data.avatarUrl : "",
        role: typeof data.role === "string" ? data.role : "",
        isActive: data.isActive !== false,
      });
    }
  }
  return profiles;
}

/**
 * @param {import("firebase-admin/auth").UserRecord} u
 * @param {{ avatarUrl: string, role: string } | undefined} profile
 */
function toMigratableRow(u, profile) {
  const row = {
    uid: u.uid,
    email: u.email || "",
    displayName: u.displayName || "",
    phoneNumber: u.phoneNumber || "",
    creationTime: u.metadata?.creationTime || null,
  };
  if (profile?.avatarUrl) row.avatarUrl = profile.avatarUrl;
  const suggestedRole = profile ? mapMobileRoleToMemberRole(profile.role) : undefined;
  if (suggestedRole) row.suggestedRole = suggestedRole;
  return row;
}

/**
 * True if this uid is already a member, already indexed, or already pending —
 * i.e. not a valid Migrate candidate.
 * @param {import("firebase-admin/firestore").Firestore} db
 * @param {string} uid
 */
async function isUidAlreadyLinked(db, uid) {
  const [memberSnap, indexSnap, pendingSnap] = await Promise.all([
    db.collection("members").where("firebase_uid", "==", uid).limit(1).get(),
    db.collection(MEMBER_AUTH_INDEX).doc(uid).get(),
    db.collection(PENDING_AUTH).doc(uid).get(),
  ]);
  return !memberSnap.empty || indexSnap.exists || pendingSnap.exists;
}

/**
 * @param {import("node:http").IncomingMessage} req
 * @param {import("node:http").ServerResponse} res
 * @param {URL} url
 * @param {string|undefined} origin
 * @returns {Promise<boolean>}
 */
export async function routeMemberMigration(req, res, url, origin) {
  const db = getDb();
  if (!db) return false;
  const auth = getAuthAdmin();
  const pn = normalizePathname(url.pathname);

  if (pn === "/api/members/migratable" && req.method === "GET") {
    if (!assertMigrationManagementRole(req, res, origin)) return true;
    if (!auth) {
      sendJson(res, origin, 503, { success: false, error: "Authentication service is not configured." });
      return true;
    }

    const email = (url.searchParams.get("email") || "").trim().toLowerCase();
    const phone = (url.searchParams.get("phone") || "").trim();

    try {
      if (email || phone) {
        const u = email
          ? await auth.getUserByEmail(email).catch(() => null)
          : await auth.getUserByPhoneNumber(phone).catch(() => null);
        if (!u || u.disabled || (await isUidAlreadyLinked(db, u.uid))) {
          sendJson(res, origin, 200, { success: true, users: [], nextPageToken: null });
          return true;
        }
        // Eligible only if they actually have a mobile-app profile (proves they signed in there) and aren't deactivated there.
        const profile = (await fetchMobileProfiles(db, [u.uid])).get(u.uid);
        if (!profile || !profile.isActive) {
          sendJson(res, origin, 200, { success: true, users: [], nextPageToken: null });
          return true;
        }
        sendJson(res, origin, 200, { success: true, users: [toMigratableRow(u, profile)], nextPageToken: null });
        return true;
      }

      const pageToken = url.searchParams.get("pageToken") || undefined;
      const page = await auth.listUsers(MIGRATABLE_PAGE_SIZE, pageToken);
      const candidates = page.users.filter((u) => !u.disabled);
      const linkedFlags = await Promise.all(candidates.map((u) => isUidAlreadyLinked(db, u.uid)));
      const unlinked = candidates.filter((_, i) => !linkedFlags[i]);

      // Only people with a mobile-app profile doc are real migration candidates — an Auth
      // account with no `users/{uid}` doc means they never actually signed into the mobile app.
      const profiles = await fetchMobileProfiles(db, unlinked.map((u) => u.uid));
      const users = unlinked
        .filter((u) => {
          const profile = profiles.get(u.uid);
          return Boolean(profile) && profile.isActive;
        })
        .map((u) => toMigratableRow(u, profiles.get(u.uid)));

      sendJson(res, origin, 200, { success: true, users, nextPageToken: page.pageToken || null });
    } catch (e) {
      logSafeError("[members/migratable]", e);
      sendJson(res, origin, 500, { success: false, error: "Failed to load migratable users." });
    }
    return true;
  }

  if (pn === "/api/members/migrate" && req.method === "POST") {
    if (!assertMigrationManagementRole(req, res, origin)) return true;
    const viewer = requireAuthContext(req, res, origin);
    if (!viewer) return true;
    if (!auth) {
      sendJson(res, origin, 503, { success: false, error: "Authentication service is not configured." });
      return true;
    }

    let body;
    try {
      body = await readJsonBody(req);
      rejectUnknownFields(body, ["migrations"]);
    } catch (e) {
      sendJson(res, origin, 400, { success: false, error: e instanceof Error ? e.message : "Invalid body" });
      return true;
    }

    const seenUids = new Set();
    const migrations = Array.isArray(body.migrations)
      ? body.migrations
          .filter(
            (m) =>
              m &&
              typeof m.uid === "string" &&
              m.uid.trim() &&
              typeof m.role === "string" &&
              m.role.trim(),
          )
          .map((m) => ({ uid: m.uid.trim(), roleName: m.role.trim() }))
          .filter((m) => {
            if (seenUids.has(m.uid)) return false;
            seenUids.add(m.uid);
            return true;
          })
          .slice(0, MAX_MIGRATE_BATCH)
      : [];
    if (migrations.length === 0) {
      sendJson(res, origin, 400, { success: false, error: "migrations must be a non-empty array of { uid, role }." });
      return true;
    }

    const uniqueRoleNames = [...new Set(migrations.map((m) => m.roleName))];
    for (const roleName of uniqueRoleNames) {
      const roleErr = await validateRoleAssignment(db, viewer.roleName, { roleName });
      if (roleErr) {
        sendJson(res, origin, 403, { success: false, error: roleErr });
        return true;
      }
    }

    const roleIdByName = new Map();
    for (const roleName of uniqueRoleNames) {
      roleIdByName.set(roleName, await resolveRoleIdByName(db, roleName));
    }

    const results = [];

    for (const { uid, roleName } of migrations) {
      try {
        const userRecord = await auth.getUser(uid);

        if (await isUidAlreadyLinked(db, uid)) {
          results.push({ uid, success: false, error: "Already migrated or pending." });
          continue;
        }

        const email = (userRecord.email || "").trim().toLowerCase();
        const banCheck = await assertMemberNotBanned(db, { email, firebaseUid: uid });
        if (!banCheck.ok) {
          results.push({ uid, success: false, error: banCheck.error });
          continue;
        }

        await db.collection(PENDING_AUTH).doc(uid).set({
          email,
          display_name: userRecord.displayName || "",
          role_id: roleIdByName.get(roleName),
          pay_rate: 0,
          created_by_uid: viewer.uid,
          created_at: new Date(),
        });

        try {
          const promoted = await promotePendingMemberCore(db, auth, uid);
          if (promoted.memberId) {
            await db.collection("members").doc(promoted.memberId).set(
              { migrated_from_auth: true, migrated_at: new Date(), migrated_by: viewer.memberId },
              { merge: true },
            );
          }
          results.push({ uid, success: true, memberId: promoted.memberId ?? undefined });
        } catch (promoteErr) {
          await db.collection(PENDING_AUTH).doc(uid).delete().catch(() => {});
          throw promoteErr;
        }
      } catch (e) {
        logSafeWarn(`[members/migrate] failed for uid ${uid}`, e);
        results.push({ uid, success: false, error: e instanceof Error ? e.message : "Migration failed." });
      }
    }

    sendJson(res, origin, 200, { success: true, results });
    return true;
  }

  return false;
}
