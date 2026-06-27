import crypto from "node:crypto";

/** @typedef {"pending" | "completed" | "exchanged"} AgentLinkStatus */

const COLLECTION = "agent_link_sessions";
const TTL_MS = 15 * 60 * 1000;
const MAX_INVALID_EXCHANGE_ATTEMPTS = 8;

function randomToken() {
  return crypto.randomBytes(32).toString("base64url");
}

function toMillis(value) {
  if (!value) return 0;
  if (typeof value?.toDate === "function") return value.toDate().getTime();
  if (value instanceof Date) return value.getTime();
  if (typeof value === "number") return value;
  if (typeof value === "string") {
    const ms = Date.parse(value);
    return Number.isFinite(ms) ? ms : 0;
  }
  return 0;
}

function normalizeSession(doc) {
  const d = doc.data ? doc.data() : doc;
  const linkToken = d.link_token ?? d.linkToken ?? doc.id;
  return {
    linkToken,
    agentSecret: d.agent_secret ?? d.agentSecret ?? "",
    status: d.status ?? "pending",
    memberId: d.member_id ?? d.memberId ?? null,
    idToken: d.id_token ?? d.idToken ?? null,
    refreshToken: d.refresh_token ?? d.refreshToken ?? "",
    agentSource: d.agent_source ?? d.agentSource ?? "electron",
    expiresAt: toMillis(d.expires_at ?? d.expiresAt),
    invalidExchangeAttempts: Number(d.invalid_exchange_attempts ?? d.invalidExchangeAttempts ?? 0),
    createdAt: toMillis(d.created_at ?? d.createdAt),
  };
}

async function deleteSession(db, linkToken) {
  await db.collection(COLLECTION).doc(linkToken).delete().catch(() => {});
}

/**
 * @param {import("firebase-admin/firestore").Firestore} db
 * @param {{ agentSource?: string }} [options]
 */
export async function createAgentLinkSession(db, options = {}) {
  const linkToken = randomToken();
  const agentSecret = randomToken();
  const now = Date.now();
  const expiresAt = now + TTL_MS;
  const row = {
    link_token: linkToken,
    agent_secret: agentSecret,
    status: "pending",
    member_id: null,
    id_token: null,
    refresh_token: "",
    agent_source: options.agentSource === "python" ? "python" : "electron",
    expires_at: new Date(expiresAt),
    invalid_exchange_attempts: 0,
    created_at: new Date(now),
  };
  await db.collection(COLLECTION).doc(linkToken).set(row);
  return {
    linkToken,
    agentSecret,
    expiresAt: new Date(expiresAt).toISOString(),
  };
}

/**
 * @param {import("firebase-admin/firestore").Firestore} db
 * @param {string} linkToken
 */
export async function getAgentLinkSession(db, linkToken) {
  if (!linkToken) return null;
  const snap = await db.collection(COLLECTION).doc(linkToken).get();
  if (!snap.exists) return null;
  const session = normalizeSession(snap);
  if (!session.expiresAt || session.expiresAt <= Date.now()) {
    await deleteSession(db, linkToken);
    return null;
  }
  return session;
}

/**
 * @param {import("firebase-admin/firestore").Firestore} db
 * @param {string} linkToken
 * @param {{ memberId: string, idToken: string, refreshToken?: string }} payload
 */
export async function completeAgentLinkSession(db, linkToken, payload) {
  const session = await getAgentLinkSession(db, linkToken);
  if (!session) return { ok: false, error: "Link session expired or not found" };
  if (session.status === "exchanged") {
    return { ok: false, error: "Link session is no longer available" };
  }

  await db.collection(COLLECTION).doc(linkToken).update({
    status: "completed",
    member_id: payload.memberId,
    id_token: payload.idToken,
    refresh_token: payload.refreshToken || "",
    updated_at: new Date(),
  });
  return { ok: true };
}

/**
 * @param {import("firebase-admin/firestore").Firestore} db
 * @param {string} linkToken
 * @param {string} agentSecret
 */
export async function exchangeAgentLinkSession(db, linkToken, agentSecret) {
  const session = await getAgentLinkSession(db, linkToken);
  if (!session) return { ok: false, error: "Link session expired or not found" };

  if (session.agentSecret !== agentSecret) {
    const nextAttempts = session.invalidExchangeAttempts + 1;
    if (nextAttempts > MAX_INVALID_EXCHANGE_ATTEMPTS) {
      await deleteSession(db, linkToken);
      return { ok: false, error: "Too many exchange attempts" };
    }
    await db.collection(COLLECTION).doc(linkToken).update({
      invalid_exchange_attempts: nextAttempts,
      updated_at: new Date(),
    });
    return { ok: false, error: "Invalid agent credentials" };
  }

  if (session.status !== "completed") {
    return { ok: false, error: "Link session is not ready" };
  }
  if (!session.idToken) {
    return { ok: false, error: "Missing linked credentials" };
  }

  const result = {
    idToken: session.idToken,
    refreshToken: session.refreshToken || "",
    memberId: session.memberId,
    agentSource: session.agentSource,
  };
  await deleteSession(db, linkToken);
  return { ok: true, data: result };
}
