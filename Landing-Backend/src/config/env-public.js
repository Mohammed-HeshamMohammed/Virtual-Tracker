/**
 * Safe, non-secret configuration snapshot for logs, health checks, and debugging.
 * Never log {@link getEnv} directly — secrets live in firebase.admin and notify.
 */

/**
 * @param {import("./env.js").AppEnv} config
 */
export function toPublicEnv(config) {
  return Object.freeze({
    nodeEnv: config.nodeEnv,
    isProduction: config.isProduction,
    server: Object.freeze({ port: config.server.port }),
    security: Object.freeze({ allowInsecureHttp: config.security.allowInsecureHttp }),
    urls: Object.freeze({
      frontendOrigin: config.urls.frontendOrigin,
      appPublicUrl: config.urls.appPublicUrl || null,
    }),
    dashboard: Object.freeze({ backendUrlConfigured: Boolean(config.dashboard.backendUrl) }),
    notify: Object.freeze({
      backendUrlConfigured: Boolean(config.notify.backendUrl),
      internalSecretConfigured: Boolean(config.notify.internalServiceSecret),
    }),
    firebase: Object.freeze({
      hasAdminCredentials: Boolean(
        config.firebase.admin.serviceAccountJson ||
          config.firebase.admin.googleApplicationCredentials ||
          (config.firebase.admin.clientEmail && config.firebase.admin.privateKey),
      ),
    }),
  });
}
