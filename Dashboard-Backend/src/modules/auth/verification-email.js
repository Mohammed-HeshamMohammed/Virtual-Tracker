import { sendEmailViaNotify } from "../../lib/notify/email-client.js";

/**
 * @param {{ email: string; verificationLink: string; appPublicUrl?: string }} input
 * @returns {Promise<{ sent: boolean; channel: string; error?: string }>}
 */
export async function sendEmailVerificationEmail(input) {
  const email = typeof input.email === "string" ? input.email.trim().toLowerCase() : "";
  const verificationLink =
    typeof input.verificationLink === "string" ? input.verificationLink.trim() : "";
  if (!email || !verificationLink) return { sent: false, channel: "skipped" };

  return sendEmailViaNotify("verification", {
    email,
    verificationLink,
    appPublicUrl: input.appPublicUrl,
  });
}

/**
 * @param {Record<string, unknown> | null | undefined} body
 * @param {{ urls: { appPublicUrl: string; frontendOrigin: string } }} env
 */
export function resolveAuthContinueUrl(body, env) {
  const fromBody = typeof body?.continueUrl === "string" ? body.continueUrl.trim() : "";
  if (fromBody) {
    try {
      const parsed = new URL(fromBody);
      if (parsed.protocol === "http:" || parsed.protocol === "https:") {
        return fromBody.replace(/\/$/, "");
      }
    } catch {
      // Fall through to configured defaults.
    }
  }

  const configured = (env.urls.appPublicUrl || env.urls.frontendOrigin).trim();
  return configured.replace(/\/$/, "");
}

/**
 * @param {string} continueUrl
 */
export function withEmailVerifiedContinueUrl(continueUrl) {
  try {
    const url = new URL(continueUrl);
    url.searchParams.set("emailVerified", "1");
    return url.toString();
  } catch {
    return `${continueUrl.replace(/\/$/, "")}/?emailVerified=1`;
  }
}
