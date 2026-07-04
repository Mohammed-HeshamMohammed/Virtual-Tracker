import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import admin from "firebase-admin";
import { getEnv } from "./env.js";

let db = null;
let initError = "";
/** @type {import("firebase-admin/firestore").Firestore | null} */
let testDbOverride = null;

/** @internal Test simulation only — in-memory Firestore stand-in. */
export function __setTestDb(override) {
  testDbOverride = override ?? null;
}

/** @internal */
export function __resetTestDb() {
  testDbOverride = null;
}

const LOCAL_SERVICE_ACCOUNT_FILENAME = "firebase-admin.local.json";
const getLocalServiceAccountPath = () =>
  path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", LOCAL_SERVICE_ACCOUNT_FILENAME);
const normalizePrivateKey = (value) => (typeof value === "string" && value.trim() ? value.replace(/\\n/g, "\n") : "");

function getServiceAccountFromEnv() {
  const { admin: adminCfg } = getEnv().firebase;
  const projectId = adminCfg.projectId || "";
  const clientEmail = adminCfg.clientEmail || "";
  const privateKey = normalizePrivateKey(adminCfg.privateKey);
  if (!projectId || !clientEmail || !privateKey) return null;
  return { projectId, clientEmail, privateKey };
}

export function getFirebaseStatus() {
  const { admin: adminCfg } = getEnv().firebase;
  return {
    initialized: Boolean(db),
    hasInlineJson: Boolean(adminCfg.serviceAccountJson),
    hasCredentialsPath: Boolean(adminCfg.googleApplicationCredentials),
    hasServiceAccountParts: Boolean(getServiceAccountFromEnv()),
    hasLocalServiceAccountFile: existsSync(getLocalServiceAccountPath()),
    initError,
  };
}

/** Firestore handle — only capability this service needs from Firebase Admin. */
export function getDb() {
  if (testDbOverride) return testDbOverride;
  if (db) return db;

  const json = getEnv().firebase.admin.serviceAccountJson;
  if (json) {
    try {
      const creds = JSON.parse(json);
      admin.initializeApp({ credential: admin.credential.cert(creds), projectId: creds.project_id });
      db = admin.firestore();
      return db;
    } catch (err) {
      initError = `Invalid FIREBASE_SERVICE_ACCOUNT JSON: ${err.message}`;
      return null;
    }
  }

  const credsFromParts = getServiceAccountFromEnv();
  if (credsFromParts) {
    try {
      admin.initializeApp({ credential: admin.credential.cert(credsFromParts), projectId: credsFromParts.projectId });
      db = admin.firestore();
      return db;
    } catch (err) {
      initError = `Invalid FIREBASE_* service account fields: ${err.message}`;
      return null;
    }
  }

  if (getEnv().firebase.admin.googleApplicationCredentials) {
    try {
      admin.initializeApp({ credential: admin.credential.applicationDefault() });
      db = admin.firestore();
      return db;
    } catch (err) {
      initError = `Failed using GOOGLE_APPLICATION_CREDENTIALS: ${err.message}`;
      return null;
    }
  }

  const localPath = getLocalServiceAccountPath();
  if (existsSync(localPath)) {
    try {
      const creds = JSON.parse(readFileSync(localPath, "utf8"));
      if (!creds || typeof creds !== "object" || creds.type !== "service_account") {
        initError = `Invalid ${LOCAL_SERVICE_ACCOUNT_FILENAME}: expected a Firebase service account JSON (type: service_account).`;
        return null;
      }
      admin.initializeApp({ credential: admin.credential.cert(creds), projectId: creds.project_id });
      db = admin.firestore();
      return db;
    } catch (err) {
      initError = `Failed reading ${localPath}: ${err.message}`;
      return null;
    }
  }

  initError =
    `Missing Firebase Admin credentials. Add ONE of: (1) FIREBASE_SERVICE_ACCOUNT JSON in Landing-Backend/.env, ` +
    `(2) FIREBASE_PROJECT_ID + FIREBASE_CLIENT_EMAIL + FIREBASE_PRIVATE_KEY, (3) GOOGLE_APPLICATION_CREDENTIALS path ` +
    `to the JSON file, (4) save the downloaded key as Landing-Backend/${LOCAL_SERVICE_ACCOUNT_FILENAME} (gitignored).`;
  return null;
}
