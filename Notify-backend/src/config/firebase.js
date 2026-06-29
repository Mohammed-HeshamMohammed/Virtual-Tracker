/**
 * Firebase Admin SDK initializer for Notify-Backend.
 * Only used for FCM push notifications — no Firestore access.
 *
 * Credential resolution order:
 *   1. FIREBASE_SERVICE_ACCOUNT (single-line JSON string)
 *   2. GOOGLE_APPLICATION_CREDENTIALS (path to service account file)
 *   3. Application Default Credentials (GCP only)
 */
import { getEnv } from "./env.js";

/** @type {import("firebase-admin").app.App | null} */
let _app = null;

/**
 * @returns {import("firebase-admin").app.App | null}
 */
export function getFirebaseApp() {
  return _app;
}

/**
 * Initializes Firebase Admin SDK for FCM. Call once at startup.
 * Returns null (with a warning) when no credentials are configured.
 * @returns {Promise<boolean>} true if initialized successfully
 */
export async function initFirebaseAdmin() {
  if (_app) return true;

  let admin;
  try {
    admin = (await import("firebase-admin")).default;
  } catch {
    console.warn(
      "[firebase] firebase-admin is not installed. " +
        "Run: npm install firebase-admin --save\n" +
        "       Push notifications will not be available until installed.",
    );
    return false;
  }

  const { firebase: fb } = getEnv();
  let credential = null;

  // Option 1 — FIREBASE_SERVICE_ACCOUNT JSON string
  if (fb.serviceAccount) {
    try {
      const parsed = JSON.parse(fb.serviceAccount);
      credential = admin.cert(parsed);
    } catch (err) {
      throw new Error(`[firebase] FIREBASE_SERVICE_ACCOUNT is not valid JSON: ${err.message}`);
    }
  }
  // Option 2 — GOOGLE_APPLICATION_CREDENTIALS path or ADC
  if (!credential) {
    credential = admin.applicationDefault();
  }

  if (!credential) {
    console.warn(
      "[firebase] No Firebase Admin credentials found. " +
        "Push notifications will not be available.\n" +
        "  Set FIREBASE_SERVICE_ACCOUNT in Notify-Backend/.env",
    );
    return false;
  }

  _app = admin.initializeApp({ credential });
  return true;
}

/**
 * @returns {Promise<import("firebase-admin/messaging").Messaging | null>}
 */
export async function getMessaging() {
  if (!_app) return null;
  try {
    const { getMessaging } = await import("firebase-admin/messaging");
    return getMessaging(_app);
  } catch {
    return null;
  }
}
