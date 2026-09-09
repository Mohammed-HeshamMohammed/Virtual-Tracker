
const BRAND = {
  purple: "#6b38d4",
  purpleDark: "#5a2db8",
  purpleLight: "#ede9fe",
  ink: "#0f172a",
  body: "#334155",
  muted: "#64748b",
  faint: "#94a3b8",
  bg: "#eef2f7",
  card: "#ffffff",
  border: "#e2e8f0",
  success: "#059669",
  successBg: "#ecfdf5",
  warning: "#b45309",
  warningBg: "#fffbeb",
  danger: "#dc2626",
  dangerBg: "#fef2f2",
  info: "#2563eb",
  infoBg: "#eff6ff",
};

export function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function detailTableHtml(rows) {
  if (!rows.length) return "";
  const body = rows
    .map(
      (row, i) => `
        <tr>
          <td style="padding:${i === 0 ? "0" : "10px"} 16px 10px 0;color:${BRAND.muted};font-size:13px;font-weight:600;width:108px;vertical-align:top;white-space:nowrap;">${escapeHtml(row.label)}</td>
          <td style="padding:${i === 0 ? "0" : "10px"} 0 10px;color:${BRAND.ink};font-size:14px;line-height:1.5;vertical-align:top;">${row.value}</td>
        </tr>`,
    )
    .join("");
  return `
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin:20px 0;border-collapse:collapse;background:${BRAND.bg};border:1px solid ${BRAND.border};border-radius:12px;overflow:hidden;">
      <tr>
        <td style="padding:16px 18px;">
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse;">
            ${body}
          </table>
        </td>
      </tr>
    </table>`.trim();
}

export function calloutHtml(variant, title, bodyHtml) {
  const palette = {
    info: { bg: BRAND.infoBg, border: "#bfdbfe", accent: BRAND.info },
    success: { bg: BRAND.successBg, border: "#a7f3d0", accent: BRAND.success },
    warning: { bg: BRAND.warningBg, border: "#fde68a", accent: BRAND.warning },
    danger: { bg: BRAND.dangerBg, border: "#fecaca", accent: BRAND.danger },
  }[variant];
  return `
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin:20px 0;border-collapse:collapse;">
      <tr>
        <td style="padding:16px 18px;background:${palette.bg};border:1px solid ${palette.border};border-left:4px solid ${palette.accent};border-radius:10px;">
          <p style="margin:0 0 6px;font-size:13px;font-weight:700;color:${palette.accent};letter-spacing:0.02em;text-transform:uppercase;">${escapeHtml(title)}</p>
          <div style="font-size:14px;line-height:1.6;color:${BRAND.body};">${bodyHtml}</div>
        </td>
      </tr>
    </table>`.trim();
}

export function stepsListHtml(steps) {
  const items = steps
    .map(
      (step, i) => `
        <tr>
          <td style="padding:0 14px 14px 0;vertical-align:top;width:28px;">
            <div style="width:24px;height:24px;border-radius:999px;background:linear-gradient(135deg,${BRAND.purple} 0%,${BRAND.purpleDark} 100%);color:#fff;font-size:12px;font-weight:800;line-height:24px;text-align:center;">${i + 1}</div>
          </td>
          <td style="padding:0 0 14px;font-size:14px;line-height:1.55;color:${BRAND.body};vertical-align:top;">${step}</td>
        </tr>`,
    )
    .join("");
  return `
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin:16px 0 4px;border-collapse:collapse;">
      ${items}
    </table>`.trim();
}

export function credentialPanelHtml(bodyHtml) {
  return `
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin:20px 0;border-collapse:collapse;">
      <tr>
        <td style="padding:18px 20px;background:linear-gradient(145deg,#faf5ff 0%,#f8fafc 100%);border:1px solid #ddd6fe;border-radius:12px;">
          ${bodyHtml}
        </td>
      </tr>
    </table>`.trim();
}

export function linkFallbackHtml(href) {
  return `
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin:8px 0 0;border-collapse:collapse;">
      <tr>
        <td style="padding:14px 16px;background:${BRAND.bg};border:1px dashed ${BRAND.border};border-radius:10px;">
          <p style="margin:0 0 8px;font-size:12px;font-weight:600;color:${BRAND.muted};text-transform:uppercase;letter-spacing:0.04em;">Button not working?</p>
          <p style="margin:0;font-size:13px;line-height:1.55;color:${BRAND.body};word-break:break-all;">
            Copy and paste this link into your browser:<br />
            <a href="${escapeHtml(href)}" style="color:${BRAND.purple};text-decoration:underline;">${escapeHtml(href)}</a>
          </p>
        </td>
      </tr>
    </table>`.trim();
}

export function supportFooterHtml(supportEmail, options = {}) {
  const showAutoNotice = options.showAutoNotice !== false;
  return `
    <p style="margin:0 0 10px;font-size:13px;line-height:1.6;color:${BRAND.muted};">
      Need help? Contact us at
      <a href="mailto:${escapeHtml(supportEmail)}" style="color:${BRAND.purple};font-weight:600;text-decoration:none;">${escapeHtml(supportEmail)}</a>
    </p>
    ${
      showAutoNotice
        ? `<p style="margin:0;font-size:12px;line-height:1.5;color:${BRAND.faint};">This is an automated message from Virtual Tracker. Please do not reply directly to this email.</p>`
        : ""
    }`.trim();
}

const BADGE_STYLES = {
  default: { bg: BRAND.purpleLight, color: BRAND.purpleDark },
  security: { bg: "#fef3c7", color: "#92400e" },
  welcome: { bg: BRAND.successBg, color: BRAND.success },
  invite: { bg: "#ede9fe", color: BRAND.purpleDark },
  alert: { bg: BRAND.dangerBg, color: BRAND.danger },
  admin: { bg: "#f1f5f9", color: "#475569" },
  report: { bg: BRAND.infoBg, color: BRAND.info },
};

export function buildAuthBrandedEmailHtml(input) {
  const badgeVariant = input.badgeVariant ?? "default";
  const badgeStyle = BADGE_STYLES[badgeVariant] ?? BADGE_STYLES.default;
  const preheader = input.preheader ? escapeHtml(input.preheader) : escapeHtml(input.title);

  const badgeBlock = input.badge
    ? `
            <tr>
              <td style="padding:20px 36px 0;text-align:center;">
                <span style="display:inline-block;padding:6px 14px;border-radius:999px;background:${badgeStyle.bg};color:${badgeStyle.color};font-size:11px;font-weight:800;letter-spacing:0.08em;text-transform:uppercase;">${escapeHtml(input.badge)}</span>
              </td>
            </tr>`
    : "";

  const subtitleBlock = input.subtitle
    ? `
            <tr>
              <td style="padding:8px 36px 0;font-size:15px;line-height:1.5;color:${BRAND.muted};text-align:center;">
                ${escapeHtml(input.subtitle)}
              </td>
            </tr>`
    : "";

  const primaryAction =
    input.actionLabel && input.actionHref
      ? `
            <tr>
              <td style="padding:28px 36px 8px;text-align:center;">
                <a href="${escapeHtml(input.actionHref)}" style="display:inline-block;min-width:200px;padding:15px 32px;border-radius:12px;background:linear-gradient(135deg,${BRAND.purple} 0%,${BRAND.purpleDark} 100%);color:#ffffff;font-size:15px;font-weight:700;text-decoration:none;box-shadow:0 8px 24px rgba(107,56,212,0.32);letter-spacing:0.01em;">
                  ${escapeHtml(input.actionLabel)}
                </a>
              </td>
            </tr>`
      : "";

  const secondaryAction =
    input.secondaryActionLabel && input.secondaryActionHref
      ? `
            <tr>
              <td style="padding:12px 36px 0;text-align:center;">
                <a href="${escapeHtml(input.secondaryActionHref)}" style="font-size:14px;font-weight:600;color:${BRAND.purple};text-decoration:underline;">
                  ${escapeHtml(input.secondaryActionLabel)}
                </a>
              </td>
            </tr>`
      : "";

  const footerBlock = input.footerHtml
    ? `
            <tr>
              <td style="padding:20px 36px 32px;font-size:13px;line-height:1.65;color:${BRAND.muted};border-top:1px solid ${BRAND.border};">
                ${input.footerHtml}
              </td>
            </tr>`
    : `
            <tr>
              <td style="padding:20px 36px 28px;font-size:12px;line-height:1.5;color:${BRAND.faint};text-align:center;border-top:1px solid ${BRAND.border};">
                © ${new Date().getFullYear()} Virtual Tracker · <a href="https://myvirtualtracker.com" style="color:${BRAND.purple};text-decoration:none;">myvirtualtracker.com</a>
              </td>
            </tr>`;

  return `<!DOCTYPE html>
<html lang="en" xmlns="http://www.w3.org/1999/xhtml">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta http-equiv="X-UA-Compatible" content="IE=edge" />
    <meta name="x-apple-disable-message-reformatting" />
    <meta name="color-scheme" content="light" />
    <meta name="supported-color-schemes" content="light" />
    <title>${escapeHtml(input.title)}</title>
    <!--[if mso]><style>table,td{font-family:Arial,Helvetica,sans-serif!important;}</style><![endif]-->
  </head>
  <body style="margin:0;padding:0;background-color:${BRAND.bg};font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;-webkit-font-smoothing:antialiased;">
    <div style="display:none;max-height:0;overflow:hidden;mso-hide:all;">${preheader}&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;</div>
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background-color:${BRAND.bg};padding:40px 16px;">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:600px;background-color:${BRAND.card};border:1px solid ${BRAND.border};border-radius:20px;overflow:hidden;box-shadow:0 24px 64px rgba(15,23,42,0.08);">
            <tr>
              <td style="height:6px;background:linear-gradient(90deg,${BRAND.purple} 0%,#8b5cf6 50%,${BRAND.purpleDark} 100%);font-size:0;line-height:0;">&nbsp;</td>
            </tr>
            <tr>
              <td style="padding:28px 36px 12px;text-align:center;">
                <div style="font-size:24px;font-weight:900;letter-spacing:-0.03em;color:${BRAND.ink};">Virtual Tracker</div>
                <div style="margin-top:6px;font-size:12px;font-weight:600;color:${BRAND.faint};letter-spacing:0.06em;text-transform:uppercase;">Workforce visibility &amp; time intelligence</div>
              </td>
            </tr>
            ${badgeBlock}
            <tr>
              <td style="padding:16px 36px 0;font-size:26px;font-weight:800;line-height:1.25;color:${BRAND.ink};text-align:center;letter-spacing:-0.02em;">
                ${escapeHtml(input.title)}
              </td>
            </tr>
            ${subtitleBlock}
            <tr>
              <td style="padding:20px 36px 0;font-size:15px;line-height:1.7;color:${BRAND.body};">
                ${input.bodyHtml}
              </td>
            </tr>
            ${primaryAction}
            ${secondaryAction}
            ${footerBlock}
          </table>
          <p style="margin:20px 0 0;font-size:11px;line-height:1.5;color:${BRAND.faint};max-width:600px;text-align:center;">
            You received this email because of activity on your Virtual Tracker account or an invitation sent to your address.
          </p>
        </td>
      </tr>
    </table>
  </body>
</html>`.trim();
}

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
