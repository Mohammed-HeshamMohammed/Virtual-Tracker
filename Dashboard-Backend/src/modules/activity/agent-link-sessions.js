import crypto from "node:crypto";
import { query } from "../../lib/postgres/client.js";
import { newDeviceId, registerAgentDevice } from "./agent-devices.service.js";

const TTL_MS = 15 * 60 * 1000;
const MAX_INVALID_EXCHANGE_ATTEMPTS = 8;

function randomToken() {
  return crypto.randomBytes(32).toString("base64url");
}

function normalizeRow(row) {
  return {
    linkToken: row.link_token,
    agentSecret: row.agent_secret,
    status: row.status,
    memberId: row.member_id,
    idToken: row.id_token,
    refreshToken: row.refresh_token ?? "",
    agentSource: row.agent_source,
    expiresAt: row.expires_at.getTime(),
    invalidExchangeAttempts: row.invalid_exchange_attempts,
    createdAt: row.created_at.getTime(),
  };
}

async function deleteSession(linkToken) {
  await query("DELETE FROM agent_link_sessions WHERE link_token = $1", [linkToken]).catch(() => {});
}

export async function createAgentLinkSession(options = {}) {
  const linkToken = randomToken();
  const agentSecret = randomToken();
  const now = Date.now();
  const expiresAt = now + TTL_MS;
  const agentSource = options.agentSource === "python" ? "python" : "electron";
  await query(
    `INSERT INTO agent_link_sessions (link_token, agent_secret, agent_source, expires_at)
     VALUES ($1, $2, $3, $4)`,
    [linkToken, agentSecret, agentSource, new Date(expiresAt)],
  );
  return {
    linkToken,
    agentSecret,
    expiresAt: new Date(expiresAt).toISOString(),
  };
}

export async function getAgentLinkSession(linkToken) {
  if (!linkToken) return null;
  const rows = await query("SELECT * FROM agent_link_sessions WHERE link_token = $1", [linkToken]);
  const row = rows[0];
  if (!row) return null;
  const session = normalizeRow(row);
  if (!session.expiresAt || session.expiresAt <= Date.now()) {
    await deleteSession(linkToken);
    return null;
  }
  return session;
}

/**
 * @param {string} linkToken
 * @param {{ memberId: string, idToken: string, refreshToken?: string }} payload
 */
export async function completeAgentLinkSession(linkToken, payload) {
  const session = await getAgentLinkSession(linkToken);
  if (!session) return { ok: false, error: "Link session expired or not found" };
  if (session.status === "exchanged") {
    return { ok: false, error: "Link session is no longer available" };
  }

  await query(
    `UPDATE agent_link_sessions
     SET status = 'completed', member_id = $2, id_token = $3, refresh_token = $4, updated_at = now()
     WHERE link_token = $1`,
    [linkToken, payload.memberId, payload.idToken, payload.refreshToken || ""],
  );
  return { ok: true };
}

/**
 * @param {string} linkToken
 * @param {string} agentSecret
 */
export async function exchangeAgentLinkSession(linkToken, agentSecret) {
  const session = await getAgentLinkSession(linkToken);
  if (!session) return { ok: false, error: "Link session expired or not found" };

  if (session.agentSecret !== agentSecret) {
    const nextAttempts = session.invalidExchangeAttempts + 1;
    if (nextAttempts > MAX_INVALID_EXCHANGE_ATTEMPTS) {
      await deleteSession(linkToken);
      return { ok: false, error: "Too many exchange attempts" };
    }
    await query(
      "UPDATE agent_link_sessions SET invalid_exchange_attempts = $2, updated_at = now() WHERE link_token = $1",
      [linkToken, nextAttempts],
    );
    return { ok: false, error: "Invalid agent credentials" };
  }

  if (session.status !== "completed") {
    return { ok: false, error: "Link session is not ready" };
  }
  if (!session.idToken) {
    return { ok: false, error: "Missing linked credentials" };
  }

  // Promote the (already agent-only) link secret into a long-lived device
  // credential, so this machine can re-authenticate on its own later instead
  // of needing another browser link. Best-effort: linking must still succeed
  // if this fails, the agent just loses in-app recovery until it re-links.
  let deviceId = "";
  try {
    const device = await registerAgentDevice({
      memberId: session.memberId,
      deviceId: newDeviceId(),
      agentSecret: session.agentSecret,
      agentSource: "tauri",
    });
    deviceId = device?.device_id ?? "";
  } catch (err) {
    console.warn("[agent-link] device registration failed:", err?.message ?? err);
  }

  const result = {
    idToken: session.idToken,
    refreshToken: session.refreshToken || "",
    memberId: session.memberId,
    agentSource: session.agentSource,
    deviceId,
    // Echoed back so the agent can persist it as its device credential; it is
    // the same value the agent already generated-and-held since link/init.
    agentSecret: session.agentSecret,
  };
  await deleteSession(linkToken);
  return { ok: true, data: result };
}
