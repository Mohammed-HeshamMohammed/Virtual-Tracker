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
const MAX_MIGRATE_BATCH = 100;
const MIGRATABLE_PAGE_SIZE = 1000;

function normalizePathname(pathname) {
  return pathname.replace(/^\/api\/v1\//, "/api/");
}

/** @param {import("firebase-admin/auth").UserRecord} u */
function toMigratableRow(u) {
  return {
    uid: u.uid,
    email: u.email || "",
    displayName: u.displayName || "",
    phoneNumber: u.phoneNumber || "",
    creationTime: u.metadata?.creationTime || null,
  };
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
        sendJson(res, origin, 200, { success: true, users: [toMigratableRow(u)], nextPageToken: null });
        return true;
      }

      const pageToken = url.searchParams.get("pageToken") || undefined;
      const page = await auth.listUsers(MIGRATABLE_PAGE_SIZE, pageToken);
      const candidates = page.users.filter((u) => !u.disabled);
      const linkedFlags = await Promise.all(candidates.map((u) => isUidAlreadyLinked(db, u.uid)));
      const users = candidates.filter((_, i) => !linkedFlags[i]).map(toMigratableRow);

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
      rejectUnknownFields(body, ["uids", "role"]);
    } catch (e) {
      sendJson(res, origin, 400, { success: false, error: e instanceof Error ? e.message : "Invalid body" });
      return true;
    }

    const uids = Array.isArray(body.uids)
      ? [...new Set(body.uids.filter((u) => typeof u === "string" && u.trim()))].slice(0, MAX_MIGRATE_BATCH)
      : [];
    const roleName = typeof body.role === "string" ? body.role.trim() : "";
    if (uids.length === 0) {
      sendJson(res, origin, 400, { success: false, error: "uids must be a non-empty array." });
      return true;
    }
    if (!roleName) {
      sendJson(res, origin, 400, { success: false, error: "role is required." });
      return true;
    }

    const roleErr = await validateRoleAssignment(db, viewer.roleName, { roleName });
    if (roleErr) {
      sendJson(res, origin, 403, { success: false, error: roleErr });
      return true;
    }

    const role_id = await resolveRoleIdByName(db, roleName);
    const results = [];

    for (const uid of uids) {
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
          role_id,
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
