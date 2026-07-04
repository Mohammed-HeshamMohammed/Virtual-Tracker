/**
 * Email routes — POST /api/notify/email
 * Accepts template-ID + data only. Never raw content from the caller.
 */
import { sendJson } from "../../http/response.js";
import { requireInternalAuth } from "../../http/internal-auth.js";
import {
  sendEmailVerificationEmail,
  sendPasswordUpdatedEmail,
  sendNewSignInAlertEmail,
  sendMemberInviteEmail,
  sendPreprovisionWelcomeEmail,
  sendRegistrationWelcomeEmail,
  sendMemberTransferEmail,
  sendMemberBanEmail,
  sendTeamWeeklyReportEmail,
  sendContactInquiryEmail,
} from "./email-builders.js";
import { isDuplicate, logDelivery } from "../notify-log/notify-log.service.js";

const ALLOWED_TEMPLATES = new Set([
  "verification",
  "password-updated",
  "new-sign-in-alert",
  "member-invite",
  "preprovision-welcome",
  "registration-welcome",
  "transfer-invite",
  "member-ban",
  "team-weekly-report",
  "contact-inquiry",
]);

/**
 * @param {import("node:http").IncomingMessage} req
 * @param {import("node:http").ServerResponse} res
 * @param {URL} url
 * @param {string|undefined} origin
 * @returns {Promise<boolean>}
 */
export async function routeEmail(req, res, url, origin) {
  if (!url.pathname.startsWith("/api/notify/email")) return false;

  if (!requireInternalAuth(req, res, origin)) return true;

  if (url.pathname === "/api/notify/email" && req.method === "POST") {
    const body = await readBody(req);
    const template = typeof body?.template === "string" ? body.template.trim() : "";

    if (!ALLOWED_TEMPLATES.has(template)) {
      sendJson(res, origin, 400, { success: false, error: `Unknown template: ${template}` });
      return true;
    }

    const recipient = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
    const recipientMemberId = typeof body.recipientMemberId === "string" ? body.recipientMemberId : null;

    const dupe = await isDuplicate({ recipient, template, channel: "email" });
    if (dupe) {
      await logDelivery({
        channel: "email",
        template,
        recipient,
        recipientMemberId,
        status: "skipped",
        metadata: { reason: "cooldown" },
      });
      sendJson(res, origin, 200, { success: true, sent: false, channel: "skipped" });
      return true;
    }

    try {
      const result = await dispatchEmailTemplate(template, body);
      await logDelivery({
        channel: "email",
        template,
        recipient,
        recipientMemberId,
        status: result.sent ? "sent" : "failed",
        errorMessage: result.error ?? null,
        metadata: { channel: result.channel },
      });
      sendJson(res, origin, 200, { success: true, ...result });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Email delivery failed";
      await logDelivery({
        channel: "email",
        template,
        recipient,
        recipientMemberId,
        status: "failed",
        errorMessage: msg,
      });
      sendJson(res, origin, 500, { success: false, error: msg });
    }
    return true;
  }

  return false;
}

async function dispatchEmailTemplate(template, body) {
  switch (template) {
    case "verification":
      return sendEmailVerificationEmail({
        email: body.email,
        verificationLink: body.verificationLink,
        appPublicUrl: body.appPublicUrl,
      });

    case "password-updated":
      return sendPasswordUpdatedEmail({
        to: body.email,
        recipientName: body.recipientName,
        reason: body.reason,
      });

    case "new-sign-in-alert":
      return sendNewSignInAlertEmail({
        to: body.email,
        recipientName: body.recipientName,
        ip: body.ip,
        deviceSummary: body.deviceSummary,
        signedInAt: body.signedInAt,
      });

    case "member-invite":
      return sendMemberInviteEmail({
        email: body.email,
        inviteUrl: body.inviteUrl,
        roleName: body.roleName,
      });

    case "preprovision-welcome":
      return sendPreprovisionWelcomeEmail({
        email: body.email,
        displayName: body.displayName,
        temporaryPassword: body.temporaryPassword,
        signInUrl: body.signInUrl,
      });

    case "registration-welcome":
      return sendRegistrationWelcomeEmail({
        email: body.email,
        displayName: body.displayName,
        signInUrl: body.signInUrl,
      });

    case "transfer-invite":
      return sendMemberTransferEmail({
        email: body.email,
        transferUrl: body.transferUrl,
        requesterName: body.requesterName,
      });

    case "member-ban":
      return sendMemberBanEmail({
        email: body.email,
        memberName: body.memberName,
        reason: body.reason,
      });

    case "team-weekly-report":
      return sendTeamWeeklyReportEmail({
        email: body.email,
        teamName: body.teamName,
        memberCount: body.memberCount,
        appUrl: body.appUrl,
      });

    case "contact-inquiry":
      return sendContactInquiryEmail({
        to: body.email,
        name: body.name,
        fromEmail: body.fromEmail,
        topic: body.topic,
        teamSize: body.teamSize,
        message: body.message,
      });

    default:
      throw new Error(`Unknown template: ${template}`);
  }
}

/**
 * @param {import("node:http").IncomingMessage} req
 * @returns {Promise<Record<string, unknown>>}
 */
function readBody(req) {
  return new Promise((resolve, reject) => {
    let raw = "";
    req.setEncoding("utf8");
    req.on("data", (chunk) => { raw += chunk; });
    req.on("end", () => {
      try { resolve(raw ? JSON.parse(raw) : {}); }
      catch { resolve({}); }
    });
    req.on("error", reject);
  });
}
