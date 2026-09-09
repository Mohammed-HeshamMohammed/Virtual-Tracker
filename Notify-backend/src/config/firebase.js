import { getEnv } from "./env.js";

let _app = null;

export function getFirebaseApp() {
  return _app;
}

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

  if (fb.serviceAccount) {
    try {
      const parsed = JSON.parse(fb.serviceAccount);
      credential = admin.cert(parsed);
    } catch (err) {
      throw new Error(`[firebase] FIREBASE_SERVICE_ACCOUNT is not valid JSON: ${err.message}`);
    }
  }
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

export async function getMessaging() {
  if (!_app) return null;
  try {
    const { getMessaging } = await import("firebase-admin/messaging");
    return getMessaging(_app);
  } catch {
    return null;
  }
}
