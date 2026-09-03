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
import { query as pgQuery } from "../../../lib/postgres/client.js";
import { getMemberByFirebaseUidPg, updateMemberPg } from "../../../lib/postgres/members-postgres.service.js";

const MOBILE_USERS_COLLECTION = "users";
const MAX_MIGRATE_BATCH = 100;
const MIGRATABLE_PAGE_SIZE = 1000;
const FIRESTORE_IN_CHUNK_SIZE = 30;

const MOBILE_ROLE_MAP = {
  agent: "Employee",
  candidate: "Intern",
  manager: "Manager",
  supermanager: "Super Manager",
  client: "Client",
};

function normalizeMobileRoleKey(role) {
  return String(role || "").trim().toLowerCase().replace(/[\s_]+/g, "");
}

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

async function isUidAlreadyLinked(_db, uid) {
  const [member, pendingRows] = await Promise.all([
    getMemberByFirebaseUidPg(uid),
    pgQuery("SELECT 1 FROM pending_auth_members WHERE firebase_uid = $1 LIMIT 1", [uid]),
  ]);
  return Boolean(member) || pendingRows.length > 0;
}

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

        await pgQuery(
          `INSERT INTO pending_auth_members (firebase_uid, email, display_name, role_id, pay_rate, created_by_uid, created_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7)
           ON CONFLICT (firebase_uid) DO UPDATE SET
             email = EXCLUDED.email, display_name = EXCLUDED.display_name, role_id = EXCLUDED.role_id,
             pay_rate = EXCLUDED.pay_rate, created_by_uid = EXCLUDED.created_by_uid`,
          [uid, email, userRecord.displayName || "", roleIdByName.get(roleName), 0, viewer.uid, new Date()],
        );

        try {
          const promoted = await promotePendingMemberCore(db, auth, uid);
          if (promoted.memberId) {
            await updateMemberPg(promoted.memberId, {
              migrated_from_auth: true,
              migrated_at: new Date(),
              migrated_by: viewer.memberId,
            });
          }
          results.push({ uid, success: true, memberId: promoted.memberId ?? undefined });
        } catch (promoteErr) {
          await pgQuery("DELETE FROM pending_auth_members WHERE firebase_uid = $1", [uid]).catch(() => {});
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
