/**
 * Virtual Tracker platform service registry.
 * Local defaults match main-branch dev ports; production matches Coolify deployment.
 */

const LOCAL = "local";
const PRODUCTION = "production";

/** @typedef {{ publicUrl: string; port: number; host: string; containerName: string; domain: string }} ServiceEndpoint */

/** @type {Readonly<Record<string, Readonly<Record<string, ServiceEndpoint>>>>} */
export const PLATFORM_SERVICES = Object.freeze({
  authApi: Object.freeze({
    [LOCAL]: Object.freeze({
      publicUrl: "http://localhost:5712",
      port: 5712,
      host: "127.0.0.1",
      containerName: "vt-auth-api",
      domain: "localhost:5712",
    }),
    [PRODUCTION]: Object.freeze({
      publicUrl: "https://auth.myvirtualtracker.com",
      port: 3000,
      host: "0.0.0.0",
      containerName: "vt-auth-api",
      domain: "auth.myvirtualtracker.com",
    }),
  }),
  dashboardApi: Object.freeze({
    [LOCAL]: Object.freeze({
      publicUrl: "http://localhost:5713",
      port: 5713,
      host: "127.0.0.1",
      containerName: "vt-dashboard-api",
      domain: "localhost:5713",
    }),
    [PRODUCTION]: Object.freeze({
      publicUrl: "https://dashapi.myvirtualtracker.com",
      port: 3000,
      host: "0.0.0.0",
      containerName: "vt-dashboard-api",
      domain: "dashapi.myvirtualtracker.com",
    }),
  }),
  landingApi: Object.freeze({
    [LOCAL]: Object.freeze({
      publicUrl: "http://localhost:5714",
      port: 5714,
      host: "127.0.0.1",
      containerName: "vt-landing-api",
      domain: "localhost:5714",
    }),
    [PRODUCTION]: Object.freeze({
      publicUrl: "https://api.myvirtualtracker.com",
      port: 3000,
      host: "0.0.0.0",
      containerName: "vt-landing-api",
      domain: "api.myvirtualtracker.com",
    }),
  }),
  landingWeb: Object.freeze({
    [LOCAL]: Object.freeze({
      publicUrl: "http://localhost:3001",
      port: 3001,
      host: "127.0.0.1",
      containerName: "vt-landing-web",
      domain: "localhost:3001",
    }),
    [PRODUCTION]: Object.freeze({
      publicUrl: "https://myvirtualtracker.com",
      port: 3000,
      host: "0.0.0.0",
      containerName: "vt-landing-web",
      domain: "myvirtualtracker.com",
    }),
  }),
  dashboardWeb: Object.freeze({
    [LOCAL]: Object.freeze({
      publicUrl: "http://localhost:3000",
      port: 3000,
      host: "127.0.0.1",
      containerName: "vt-dashboard-web",
      domain: "localhost:3000",
    }),
    [PRODUCTION]: Object.freeze({
      publicUrl: "https://app.myvirtualtracker.com",
      port: 3000,
      host: "0.0.0.0",
      containerName: "vt-dashboard-web",
      domain: "app.myvirtualtracker.com",
    }),
  }),
});

/**
 * @param {string} nodeEnv
 * @returns {typeof LOCAL | typeof PRODUCTION}
 */
export function getDeploymentTier(nodeEnv) {
  return nodeEnv === "production" ? PRODUCTION : LOCAL;
}

/**
 * @param {string} nodeEnv
 */
export function getServiceProfile(nodeEnv) {
  const tier = getDeploymentTier(nodeEnv);
  return Object.freeze({
    tier,
    authApi: PLATFORM_SERVICES.authApi[tier],
    dashboardApi: PLATFORM_SERVICES.dashboardApi[tier],
    landingApi: PLATFORM_SERVICES.landingApi[tier],
    landingWeb: PLATFORM_SERVICES.landingWeb[tier],
    dashboardWeb: PLATFORM_SERVICES.dashboardWeb[tier],
  });
}

/**
 * Default browser origins allowed to call the auth API (dashboard + landing frontends).
 * @param {string} nodeEnv
 * @returns {readonly string[]}
 */
export function defaultCorsOrigins(nodeEnv) {
  const { dashboardWeb, landingWeb } = getServiceProfile(nodeEnv);
  /** @type {string[]} */
  const origins = [dashboardWeb.publicUrl, landingWeb.publicUrl];

  if (getDeploymentTier(nodeEnv) === LOCAL) {
    for (const url of [...origins]) {
      const alt = url.replace("localhost", "127.0.0.1");
      if (alt !== url && !origins.includes(alt)) {
        origins.push(alt);
      }
    }
  }

  return Object.freeze(origins);
}
