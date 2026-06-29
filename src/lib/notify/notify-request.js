/**
 * Shared HTTP client for internal Notify-Backend calls.
 */
import { getEnv } from "../../config/env.js";

/**
 * @param {string} path
 * @param {Record<string, unknown>} body
 * @returns {Promise<{ response: Response; payload: Record<string, unknown> | null }>}
 */
export async function notifyRequest(path, body) {
  const env = getEnv();
  const baseUrl = (env.notify.backendUrl || "http://localhost:5715").replace(/\/+$/, "");
  const secret = env.notify.internalServiceSecret || "";

  const headers = { "Content-Type": "application/json" };
  if (secret) {
    headers.Authorization = `Bearer ${secret}`;
  }

  let response;
  try {
    response = await fetch(`${baseUrl}${path}`, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });
  } catch {
    throw new Error("Notify service is temporarily unavailable.");
  }

  let payload = null;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }

  return { response, payload };
}
