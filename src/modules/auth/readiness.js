import { quotaErrorHttpResponse } from "../../http/quota-error.js";

const READINESS_COLLECTION = "_meta";
const READINESS_DOC_ID = "readiness";

/**
 * Lightweight Firestore probe for login/bootstrap pre-checks.
 * A missing document still proves the database is reachable.
 *
 * @param {import("firebase-admin/firestore").Firestore | null | undefined} db
 * @returns {Promise<{ ok: true } | { ok: false, status: number, code: string, error: string }>}
 */
export async function probeFirestoreReadiness(db) {
  if (!db) {
    return {
      ok: false,
      status: 503,
      code: "SERVICE_UNAVAILABLE",
      error: "Firestore is not configured.",
    };
  }

  try {
    await db.collection(READINESS_COLLECTION).doc(READINESS_DOC_ID).get();
    return { ok: true };
  } catch (err) {
    const quota = quotaErrorHttpResponse(err);
    if (quota) {
      return {
        ok: false,
        status: quota.status,
        code: quota.body.code,
        error: quota.body.error,
      };
    }
    return {
      ok: false,
      status: 503,
      code: "SERVICE_UNAVAILABLE",
      error: "Unable to reach the database. The platform may be temporarily unavailable.",
    };
  }
}
