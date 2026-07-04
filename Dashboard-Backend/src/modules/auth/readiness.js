import { quotaErrorHttpResponse } from "../../http/quota-error.js";
import { isPostgresConfigured, probePostgresReadiness } from "../../lib/postgres/client.js";

const READINESS_COLLECTION = "_meta";
const READINESS_DOC_ID = "readiness";

/**
 * Quick Firestore ping for login/bootstrap. Missing doc still means DB is up.
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
    if (isPostgresConfigured()) {
      const pgOk = await probePostgresReadiness();
      if (!pgOk) {
        return {
          ok: false,
          status: 503,
          code: "SERVICE_UNAVAILABLE",
          error: "Unable to reach PostgreSQL.",
        };
      }
    }
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
