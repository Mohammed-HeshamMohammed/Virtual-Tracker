import { escapeHtml } from "./transactional-email.js";

/**
 * Branded HTML wrapper matching the Virtual Tracker auth page (light theme).
 *
 * @param {{ title: string; bodyHtml: string; actionLabel?: string; actionHref?: string; footerHtml?: string }} input
 */
export function buildAuthBrandedEmailHtml(input) {
  const actionBlock =
    input.actionLabel && input.actionHref
      ? `
    <tr>
      <td style="padding:28px 32px 8px;text-align:center;">
        <a href="${escapeHtml(input.actionHref)}" style="display:inline-block;padding:14px 28px;border-radius:12px;background:linear-gradient(135deg,#6b38d4 0%,#5a2db8 100%);color:#ffffff;font-size:15px;font-weight:700;text-decoration:none;box-shadow:0 4px 20px rgba(107,56,212,0.28);">
          ${escapeHtml(input.actionLabel)}
        </a>
      </td>
    </tr>`
      : "";

  const footerBlock = input.footerHtml
    ? `
    <tr>
      <td style="padding:8px 32px 28px;font-size:13px;line-height:1.6;color:#64748b;">
        ${input.footerHtml}
      </td>
    </tr>`
    : "";

  return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(input.title)}</title>
  </head>
  <body style="margin:0;padding:0;background-color:#f6fafe;font-family:Inter,Segoe UI,Roboto,Helvetica,Arial,sans-serif;">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background-color:#f6fafe;padding:32px 16px;">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:520px;background-color:#ffffff;border:1px solid rgba(203,195,215,0.45);border-radius:16px;overflow:hidden;box-shadow:0 20px 60px rgba(107,56,212,0.08);">
            <tr>
              <td style="padding:28px 32px 8px;text-align:center;">
                <div style="font-size:22px;font-weight:900;letter-spacing:-0.02em;color:#171c1f;">Virtual Tracker</div>
                <div style="margin-top:4px;font-size:12px;color:#94a3b8;">virtualtracker.com</div>
              </td>
            </tr>
            <tr>
              <td style="padding:8px 32px 0;font-size:22px;font-weight:800;line-height:1.25;color:#171c1f;text-align:center;">
                ${escapeHtml(input.title)}
              </td>
            </tr>
            <tr>
              <td style="padding:16px 32px 0;font-size:15px;line-height:1.65;color:#475569;">
                ${input.bodyHtml}
              </td>
            </tr>
            ${actionBlock}
            ${footerBlock}
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`.trim();
}

/**
 * Rewrites Firebase-hosted action links to the app handler route.
 *
 * @param {string} link
 * @param {string} appPublicUrl
 */
export function rewriteFirebaseActionLinkToAppHandler(link, appPublicUrl) {
  try {
    const source = new URL(link);
    const base = typeof appPublicUrl === "string" ? appPublicUrl.trim().replace(/\/+$/, "") : "";
    if (!base) return link;
    const target = new URL("/auth/action", base);
    target.search = source.search;
    return target.toString();
  } catch {
    return link;
  }
}
