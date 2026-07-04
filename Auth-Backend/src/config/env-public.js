/**
 * Safe, non-secret configuration snapshot for logs, health checks, and debugging.
 * Never log {@link getEnv} directly — secrets live in email, firebase.admin, and monitor.
 */

/**
 * @param {import("./env.js").AppEnv} config
 */
export function toPublicEnv(config) {
  const emailConfigured = Boolean(
    config.email.resendApiKey || (config.email.smtpHost && config.email.smtpUser && config.email.smtpPass),
  );
  const emailChannel = config.email.resendApiKey
    ? "resend"
    : config.email.smtpHost && config.email.smtpUser && config.email.smtpPass
      ? "smtp"
      : "none";

  return Object.freeze({
    nodeEnv: config.nodeEnv,
    isProduction: config.isProduction,
    server: Object.freeze({ port: config.server.port }),
    security: Object.freeze({
      allowInsecureHttp: config.security.allowInsecureHttp,
      disableTlsVerificationInDev: config.security.disableTlsVerificationInDev,
    }),
    urls: Object.freeze({
      frontendOrigin: config.urls.frontendOrigin,
      appPublicUrl: config.urls.appPublicUrl || null,
    }),
    firebase: Object.freeze({
      hasWebConfig: Boolean(
        config.firebase.web.apiKey &&
          config.firebase.web.projectId &&
          config.firebase.web.appId,
      ),
      projectId: config.firebase.web.projectId || null,
      hasAdminCredentials: Boolean(
        config.firebase.admin.serviceAccountJson ||
          config.firebase.admin.googleApplicationCredentials ||
          (config.firebase.admin.clientEmail && config.firebase.admin.privateKey),
      ),
      hasWebPushVapidKey: Boolean(config.firebase.webPush.vapidPublicKey),
    }),
    email: Object.freeze({
      configured: emailConfigured,
      channel: emailChannel,
      from: emailConfigured ? (config.email.resendFrom || config.email.smtpFrom || null) : null,
    }),
    invites: Object.freeze({ shareLinkTtlHours: config.invites.shareLinkTtlHours }),
    monitor: Object.freeze({
      username: config.monitor.username,
      passwordConfigured: config.monitor.password.length >= 8,
    }),
    activity: Object.freeze({
      captureMode: config.activity.captureMode,
      webCaptureEnabled: config.activity.webCaptureEnabled,
      taskScreenshotsEnabled: config.activity.taskScreenshotsEnabled,
      desktopAgentIngestEnabled: config.activity.desktopAgentIngestEnabled,
      sessionStaleMs: config.activity.sessionStaleMs,
      vtAuthPort: config.activity.vtAuthPort,
    }),
    presence: Object.freeze({ ...config.presence }),
  });
}
