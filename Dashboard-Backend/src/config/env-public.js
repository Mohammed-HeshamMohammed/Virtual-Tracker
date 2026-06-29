/**
 * Safe, non-secret configuration snapshot for logs, health checks, and debugging.
 * Never log {@link getEnv} directly — secrets live in firebase.admin, monitor, and INTERNAL_SERVICE_SECRET.
 */

/**
 * @param {import("./env.js").AppEnv} config
 */
export function toPublicEnv(config) {
  return Object.freeze({
    nodeEnv: config.nodeEnv,
    isProduction: config.isProduction,
    server: Object.freeze({ port: config.server.port }),
    security: Object.freeze({
      allowInsecureHttp: config.security.allowInsecureHttp,
      disableTlsVerificationInDev: config.security.disableTlsVerificationInDev,
    }),
    cors: Object.freeze({ originCount: config.cors.origins.length }),
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
    notify: Object.freeze({
      backendUrl: config.notify.backendUrl || null,
      internalSecretConfigured: Boolean(config.notify.internalServiceSecret),
    }),
    auth: Object.freeze({
      backendUrl: config.auth.backendUrl || null,
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
