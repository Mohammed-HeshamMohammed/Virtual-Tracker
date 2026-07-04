/** Redacted env for logs/health. @param {import("./env.js").AppEnv} config */
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
  });
}
