import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import admin from "firebase-admin";
import { getEnv } from "./env.js";

let db = null;
let initError = "";
/** @type {import("firebase-admin/firestore").Firestore | null} */
let testDbOverride = null;
/** @type {import("firebase-admin/auth").Auth | null} */
let testAuthOverride = null;

/** @internal Test simulation only — in-memory Firestore stand-in. */
export function __setTestDb(override) {
  testDbOverride = override ?? null;
}

/** @internal Test simulation only — mock Firebase Auth Admin. */
export function __setTestAuth(override) {
  testAuthOverride = override ?? null;
}

/** @internal */
export function __resetTestDb() {
  testDbOverride = null;
  testAuthOverride = null;
}
const LOCAL_SERVICE_ACCOUNT_FILENAME = "firebase-admin.local.json";
const LOCAL_WEB_CONFIG_FILENAME = "firebase-web.local.json";
const getLocalServiceAccountPath = () => path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", LOCAL_SERVICE_ACCOUNT_FILENAME);
const getLocalWebConfigPath = () => path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", LOCAL_WEB_CONFIG_FILENAME);
const normalizePrivateKey = (value) => (typeof value === "string" && value.trim() ? value.replace(/\\n/g, "\n") : "");

function readFirebaseWebConfigFromLocalFile() {
  const localPath = getLocalWebConfigPath();
  if (!existsSync(localPath)) return null;
  try {
    const raw = JSON.parse(readFileSync(localPath, "utf8"));
    if (!raw || typeof raw !== "object") return null;
    return {
      apiKey: typeof raw.apiKey === "string" ? raw.apiKey : "",
      authDomain: typeof raw.authDomain === "string" ? raw.authDomain : "",
      projectId: typeof raw.projectId === "string" ? raw.projectId : "",
      storageBucket: typeof raw.storageBucket === "string" ? raw.storageBucket : "",
      messagingSenderId: typeof raw.messagingSenderId === "string" ? raw.messagingSenderId : "",
      appId: typeof raw.appId === "string" ? raw.appId : "",
      measurementId: typeof raw.measurementId === "string" ? raw.measurementId : "",
    };
  } catch {
    return null;
  }
}

function isPlaceholderFirebaseWebValue(value) {
  if (typeof value !== "string" || !value.trim()) return true;
  const lower = value.trim().toLowerCase();
  return lower.includes("your-project-id") || lower.includes("your_project_id");
}

/** Default RTDB URL for a Firebase project (classic hostname). */
export function defaultFirebaseDatabaseUrl(projectId) {
  const id = typeof projectId === "string" ? projectId.trim() : "";
  if (!id) return "";
  return `https://${id}-default-rtdb.firebaseio.com`;
}

/**
 * Resolve the RTDB URL used by Admin SDK and presence.
 * When FIREBASE_DATABASE_URL is unset, derives it from FIREBASE_PROJECT_ID.
 */
export function resolveFirebaseDatabaseUrl() {
  const projectId = readFirebaseWebConfigFromEnv().projectId;
  const explicit = getEnv().firebase.admin.databaseUrl.trim();
  if (explicit) {
    return { url: explicit, source: "env", projectId };
  }
  const derived = defaultFirebaseDatabaseUrl(projectId);
  if (derived) {
    return { url: derived, source: "derived", projectId };
  }
  return { url: "", source: "none", projectId };
}

/** @returns {string | null} warning message when misconfigured */
export function warnIfDatabaseUrlMismatch() {
  const { url, source, projectId } = resolveFirebaseDatabaseUrl();
  if (!url || !projectId || source !== "env") return null;
  try {
    const host = new URL(url).hostname.toLowerCase();
    const normalizedId = projectId.toLowerCase();
    if (host.includes(normalizedId)) return null;
    const slug = host.split("-default-rtdb")[0] ?? "";
    if (slug === normalizedId) return null;
  } catch {
    return null;
  }

  const expected = defaultFirebaseDatabaseUrl(projectId);
  const message =
    `[firebase] FIREBASE_DATABASE_URL does not match FIREBASE_PROJECT_ID (${projectId}). ` +
    `RTDB presence sync will fail. Set FIREBASE_DATABASE_URL=${expected} ` +
    `(and enable Realtime Database in Firebase Console for ${projectId}).`;
  console.warn(message);
  return message;
}

export function readFirebaseWebConfigFromEnv() {
  const fromFile = readFirebaseWebConfigFromLocalFile();
  const web = getEnv().firebase.web;
  const pick = (envValue, fileKey) => {
    if (typeof envValue === "string" && envValue.trim() && !isPlaceholderFirebaseWebValue(envValue)) {
      return envValue.trim();
    }
    const fromLocal = fromFile?.[fileKey];
    return typeof fromLocal === "string" ? fromLocal : "";
  };
  return {
    apiKey: pick(web.apiKey, "apiKey"),
    authDomain: pick(web.authDomain, "authDomain"),
    projectId: pick(web.projectId, "projectId"),
    storageBucket: pick(web.storageBucket, "storageBucket"),
    messagingSenderId: pick(web.messagingSenderId, "messagingSenderId"),
    appId: pick(web.appId, "appId"),
    measurementId: pick(web.measurementId, "measurementId"),
  };
}
const adminOptionsFromWebConfig = (overrides, credentialProjectId) => {
  const cfg = readFirebaseWebConfigFromEnv();
  const opts = { ...overrides };
  const webProjectId = cfg.projectId || "";
  const adminProjectId = credentialProjectId || webProjectId;
  if (credentialProjectId && webProjectId && credentialProjectId !== webProjectId) {
    console.warn(
      `[firebase] Web config project (${webProjectId}) differs from service account (${credentialProjectId}); using service account project for Admin SDK.`,
    );
  }
  if (adminProjectId) opts.projectId = adminProjectId;
  if (cfg.storageBucket) opts.storageBucket = cfg.storageBucket;
  const { url: dbUrl } = resolveFirebaseDatabaseUrl();
  if (dbUrl) {
    opts.databaseURL = dbUrl;
  }
  return opts;
};
function getServiceAccountFromEnv() {
  const projectId = readFirebaseWebConfigFromEnv().projectId;
  const { admin: adminCfg } = getEnv().firebase;
  const clientEmail = adminCfg.clientEmail || "";
  const privateKey = normalizePrivateKey(adminCfg.privateKey);
  const privateKeyId = adminCfg.privateKeyId || undefined;
  if (!projectId || !clientEmail || !privateKey) return null;
  return { projectId, clientEmail, privateKey, privateKeyId };
}
export function getFirebaseStatus() {
  const web = readFirebaseWebConfigFromEnv();
  const { admin: adminCfg } = getEnv().firebase;
  return {
    initialized: Boolean(db),
    hasInlineJson: Boolean(adminCfg.serviceAccountJson),
    hasCredentialsPath: Boolean(adminCfg.googleApplicationCredentials),
    hasServiceAccountParts: Boolean(getServiceAccountFromEnv()),
    hasLocalServiceAccountFile: existsSync(getLocalServiceAccountPath()),
    hasProjectId: Boolean(web.projectId),
    hasWebFirebaseConfig: Boolean(web.apiKey && web.authDomain && web.projectId && web.storageBucket && web.messagingSenderId && web.appId),
    hasWebMeasurementId: Boolean(web.measurementId),
    initError,
  };
}
export function getDb() {
  if (testDbOverride) return testDbOverride;
  if (db) return db;
  const json = getEnv().firebase.admin.serviceAccountJson;
  if (json) {
    try {
      const creds = JSON.parse(json);
      admin.initializeApp(adminOptionsFromWebConfig({ credential: admin.credential.cert(creds) }, creds.project_id));
      db = admin.firestore();
      return db;
    } catch (err) { initError = `Invalid FIREBASE_SERVICE_ACCOUNT JSON: ${err.message}`; return null; }
  }
  const credsFromParts = getServiceAccountFromEnv();
  if (credsFromParts) {
    try {
      admin.initializeApp(adminOptionsFromWebConfig({ credential: admin.credential.cert(credsFromParts) }, credsFromParts.projectId));
      db = admin.firestore();
      return db;
    } catch (err) { initError = `Invalid FIREBASE_* service account fields: ${err.message}`; return null; }
  }
  if (getEnv().firebase.admin.googleApplicationCredentials) {
    try {
      admin.initializeApp(adminOptionsFromWebConfig({ credential: admin.credential.applicationDefault() }));
      db = admin.firestore();
      return db;
    } catch (err) { initError = `Failed using GOOGLE_APPLICATION_CREDENTIALS: ${err.message}`; return null; }
  }
  const localPath = getLocalServiceAccountPath();
  if (existsSync(localPath)) {
    try {
      const creds = JSON.parse(readFileSync(localPath, "utf8"));
      if (!creds || typeof creds !== "object" || creds.type !== "service_account") { initError = `Invalid ${LOCAL_SERVICE_ACCOUNT_FILENAME}: expected a Firebase service account JSON (type: service_account).`; return null; }
      admin.initializeApp(adminOptionsFromWebConfig({ credential: admin.credential.cert(creds) }, creds.project_id));
      db = admin.firestore();
      return db;
    } catch (err) { initError = `Failed reading ${localPath}: ${err.message}`; return null; }
  }
  initError = `Missing Firebase Admin credentials. Add ONE of: (1) FIREBASE_SERVICE_ACCOUNT JSON in Backend/.env, (2) FIREBASE_CLIENT_EMAIL + FIREBASE_PRIVATE_KEY, (3) GOOGLE_APPLICATION_CREDENTIALS path to the JSON file, (4) save the downloaded key as Backend/${LOCAL_SERVICE_ACCOUNT_FILENAME} (gitignored). See Firebase Console -> Project settings -> Service accounts -> Generate new private key.`;
  return null;
}

function defaultTestAuth() {
  return {
    verifyIdToken: async () => ({ uid: "firebase-uid-1", email: "owner@test.local" }),
    getUser: async () => ({ uid: "firebase-uid-1", email: "owner@test.local" }),
  };
}

/** Firebase Auth Admin API; requires a successful {@link getDb} init (same app instance). */
export function getAuthAdmin() {
  if (testAuthOverride) return testAuthOverride;
  if (testDbOverride) return defaultTestAuth();
  if (!getDb()) return null;
  try {
    return admin.auth();
  } catch {
    return null;
  }
}

/**
 * Resolves the GCS bucket name for Firebase Storage.
 * Uses `FIREBASE_STORAGE_BUCKET` when set; otherwise the classic default `{projectId}.appspot.com`.
 */
export function resolveStorageBucketName() {
  const web = readFirebaseWebConfigFromEnv();
  const fromEnv = (web.storageBucket || "").trim();
  if (fromEnv) return fromEnv;
  if (web.projectId) return `${web.projectId}.appspot.com`;
  return "";
}

/** @returns {string[]} Candidate bucket names, most preferred first. */
export function resolveStorageBucketCandidates() {
  const web = readFirebaseWebConfigFromEnv();
  const projectId = (web.projectId || "").trim();
  const configured = (web.storageBucket || "").trim();
  /** @type {string[]} */
  const candidates = [];
  if (configured) candidates.push(configured);
  if (projectId) {
    candidates.push(`${projectId}.appspot.com`);
    candidates.push(`${projectId}.firebasestorage.app`);
  }
  return [...new Set(candidates.filter(Boolean))];
}

/** @type {import("@google-cloud/storage").Bucket | null} */
let resolvedStorageBucket = null;
/** @type {Promise<import("@google-cloud/storage").Bucket | null> | null} */
let resolveStorageBucketPromise = null;

/**
 * Resolves the first Storage bucket that exists for this project (cached after first success).
 * @returns {Promise<import("@google-cloud/storage").Bucket | null>}
 */
export async function getStorageBucketAsync() {
  if (!getDb()) return null;
  if (resolvedStorageBucket) return resolvedStorageBucket;
  if (!resolveStorageBucketPromise) {
    resolveStorageBucketPromise = (async () => {
      const candidates = resolveStorageBucketCandidates();
      for (const name of candidates) {
        try {
          const bucket = admin.storage().bucket(name);
          const [exists] = await bucket.exists();
          if (exists) {
            resolvedStorageBucket = bucket;
            if (name !== candidates[0]) {
              console.warn(
                `[firebase] Using storage bucket "${name}"` +
                  (candidates[0] ? ` ("${candidates[0]}" was not found).` : "."),
              );
            }
            return bucket;
          }
        } catch (err) {
          console.warn(
            `[firebase] storage bucket "${name}" check failed:`,
            err instanceof Error ? err.message : err,
          );
        }
      }
      try {
        const bucket = admin.storage().bucket();
        const [exists] = await bucket.exists();
        if (exists) {
          resolvedStorageBucket = bucket;
          return bucket;
        }
      } catch {
        /* ignore */
      }
      return null;
    })();
  }
  return resolveStorageBucketPromise;
}

/**
 * @param {string} [detail] Optional underlying error message from GCS.
 */
export function formatStorageSetupError(detail = "") {
  const web = readFirebaseWebConfigFromEnv();
  const projectId = web.projectId || "your-project-id";
  const tried = resolveStorageBucketCandidates().join(", ") || "(none configured)";
  const lower = detail.toLowerCase();
  if (lower.includes("bucket does not exist") || lower.includes("not found")) {
    return (
      `STORAGE_UNAVAILABLE: Firebase Storage is not enabled for project "${projectId}". ` +
      `Open Firebase Console → Build → Storage → Get started, create the default bucket, then set ` +
      `FIREBASE_STORAGE_BUCKET in Backend/.env to the bucket name shown (often ${projectId}.appspot.com). ` +
      `Tried: ${tried}.`
    );
  }
  return (
    `STORAGE_UNAVAILABLE: Could not use Firebase Storage (${detail || "unknown error"}). ` +
    `Confirm Storage is enabled and FIREBASE_STORAGE_BUCKET is correct. Tried: ${tried}.`
  );
}

/** Default Storage bucket for the initialized app (sync; may be null until {@link getStorageBucketAsync} runs). */
export function getStorageBucket() {
  if (resolvedStorageBucket) return resolvedStorageBucket;
  if (!getDb()) return null;
  const bucketName = resolveStorageBucketName();
  if (!bucketName) return null;
  try {
    return admin.storage().bucket(bucketName);
  } catch (err) {
    console.warn("[firebase] getStorageBucket failed:", err instanceof Error ? err.message : err);
    return null;
  }
}
