/**
 * Auth-Backend env config. Use getEnv() — lint blocks direct process.env reads.
 * @see Auth-Backend/.env.example
 */

import { loadEnvFile } from "node:process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { validateEnvSource } from "./env-schema.js";
import { toPublicEnv } from "./env-public.js";

const BACKEND_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

try {
  loadEnvFile(path.join(BACKEND_ROOT, ".env"));
} catch {
  // Optional — npm scripts also pass --env-file-if-exists=.env
}

/** @typedef {ReturnType<typeof buildEnv>} AppEnv */

/** @param {NodeJS.ProcessEnv} source */
function readString(source, key, fallback = "") {
  const raw = source[key];
  if (typeof raw !== "string") return fallback;
  const trimmed = raw.trim();
  return trimmed || fallback;
}

/** @param {NodeJS.ProcessEnv} source */
function readInt(source, key, fallback) {
  const raw = readString(source, key, "");
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

/** @param {NodeJS.ProcessEnv} source */
function readPositiveInt(source, key, fallback) {
  const parsed = readInt(source, key, fallback);
  return parsed > 0 ? parsed : fallback;
}

/** @param {NodeJS.ProcessEnv} source */
function readBool(source, key, defaultWhenUnset) {
  const raw = readString(source, key, "");
  if (!raw) return defaultWhenUnset;
  const lower = raw.toLowerCase();
  if (lower === "true" || lower === "1" || lower === "yes") return true;
  if (lower === "false" || lower === "0" || lower === "no") return false;
  return defaultWhenUnset;
}

/** Parse + validate env into frozen AppEnv. */
export function buildEnv(source = process.env) {
  const skipValidation =
    readString(source, "SKIP_ENV_VALIDATION", "") === "1" ||
    readString(source, "SKIP_ENV_VALIDATION", "") === "true";
  if (!skipValidation) {
    validateEnvSource(source);
  }

  const nodeEnv = readString(source, "NODE_ENV", "development");
  const isProduction = nodeEnv === "production";

  const captureModeRaw = readString(source, "ACTIVITY_CAPTURE_MODE", "agent").toLowerCase();
  const captureMode = captureModeRaw === "web" ? "web" : "agent";

  return Object.freeze({
    nodeEnv,
    isProduction,
    isDevelopment: !isProduction,

    server: Object.freeze({
      port: readPositiveInt(source, "PORT", 5712),
    }),

    security: Object.freeze({
      allowInsecureHttp: readBool(source, "ALLOW_INSECURE_HTTP", false),
      /** Dev-only TLS workaround for Firebase on Windows (applied in index.js bootstrap). */
      // Requires an explicit opt-in as well as a non-production NODE_ENV.
      // It used to be `!isProduction` alone, which fails *open*: an unset or
      // misspelled NODE_ENV in a container silently turned off certificate
      // validation for every outbound call. Security posture must not depend
      // on an env var being present.
      disableTlsVerificationInDev: !isProduction && readBool(source, "DISABLE_TLS_VERIFY", false),
    }),

    urls: Object.freeze({
      frontendOrigin: readString(source, "FRONTEND_ORIGIN", "http://localhost:3000"),
      appPublicUrl: readString(source, "APP_PUBLIC_URL", ""),
      /** Dashboard-Backend base URL — used only to complete a desktop-agent
       * link session server-to-server after a Google OAuth callback (see
       * modules/auth/google-oauth.js). Not needed for any other route. */
      dashboardApiUrl: readString(source, "DASHBOARD_API_URL", ""),
    }),

    /** Desktop-agent "sign in with Google" authorization-code flow (see
     * modules/auth/google-oauth.js). All empty by default — /api/auth/google/start
     * responds with agentLinkError=not_configured until these are set. */
    googleOAuth: Object.freeze({
      clientId: readString(source, "GOOGLE_OAUTH_CLIENT_ID"),
      clientSecret: readString(source, "GOOGLE_OAUTH_CLIENT_SECRET"),
      redirectUri: readString(source, "GOOGLE_OAUTH_REDIRECT_URI"),
      stateSecret: readString(source, "GOOGLE_OAUTH_STATE_SECRET"),
      /** Optional dedicated Firebase Web API key for the server-to-server
       * accounts:signInWithIdp call in google-oauth.js. Falls back to
       * FIREBASE_API_KEY (below) when unset. Needs its own key, distinct
       * from FIREBASE_API_KEY, only if that one has an HTTP-referrer
       * (Websites) application restriction in Google Cloud Console — a
       * plain server-to-server fetch() never carries a Referer header, so a
       * referrer-restricted key always 403s this specific call regardless
       * of who's asking. Application restrictions: None; API restrictions:
       * Identity Toolkit API is enough. */
      serverApiKey: readString(source, "GOOGLE_OAUTH_SERVER_API_KEY"),
    }),

    firebase: Object.freeze({
      web: Object.freeze({
        apiKey: readString(source, "FIREBASE_API_KEY"),
        authDomain: readString(source, "FIREBASE_AUTH_DOMAIN"),
        projectId: readString(source, "FIREBASE_PROJECT_ID"),
        storageBucket: readString(source, "FIREBASE_STORAGE_BUCKET"),
        messagingSenderId: readString(source, "FIREBASE_MESSAGING_SENDER_ID"),
        appId: readString(source, "FIREBASE_APP_ID"),
        measurementId: readString(source, "FIREBASE_MEASUREMENT_ID"),
      }),
      webPush: Object.freeze({
        vapidPublicKey: readString(source, "FIREBASE_WEB_PUSH_VAPID_PUBLIC_KEY"),
      }),
      admin: Object.freeze({
        clientEmail: readString(source, "FIREBASE_CLIENT_EMAIL"),
        privateKey: readString(source, "FIREBASE_PRIVATE_KEY"),
        privateKeyId: readString(source, "FIREBASE_PRIVATE_KEY_ID"),
        serviceAccountJson: readString(source, "FIREBASE_SERVICE_ACCOUNT"),
        googleApplicationCredentials: readString(source, "GOOGLE_APPLICATION_CREDENTIALS"),
        databaseUrl: readString(source, "FIREBASE_DATABASE_URL"),
      }),
    }),

    email: Object.freeze({
      resendApiKey: readString(source, "RESEND_API_KEY"),
      resendFrom: readString(source, "RESEND_FROM", "Virtual Tracker <onboarding@resend.dev>"),
      smtpHost: readString(source, "SMTP_HOST"),
      smtpPort: readPositiveInt(source, "SMTP_PORT", 587),
      smtpSecure: readBool(source, "SMTP_SECURE", false),
      smtpUser: readString(source, "SMTP_USER"),
      smtpPass: readString(source, "SMTP_PASS"),
      smtpFrom: readString(source, "SMTP_FROM"),
      supportEmail: readString(source, "SUPPORT_EMAIL", "support@virtualtracker.com"),
    }),

    invites: Object.freeze({
      shareLinkTtlHours: readPositiveInt(source, "INVITE_SHARE_LINK_TTL_HOURS", 168),
    }),

    monitor: Object.freeze({
      username: readString(source, "MONITOR_USERNAME", "admin"),
      password: readString(source, "MONITOR_PASSWORD"),
    }),

    activity: Object.freeze({
      captureMode,
      webCaptureEnabled: readBool(source, "ACTIVITY_WEB_CAPTURE_ENABLED", true),
      taskScreenshotsEnabled: readBool(source, "ACTIVITY_TASK_SCREENSHOTS_ENABLED", false),
      desktopAgentIngestEnabled: readBool(source, "ACTIVITY_DESKTOP_AGENT_INGEST_ENABLED", !isProduction),
      sessionStaleMs: readPositiveInt(source, "ACTIVITY_SESSION_STALE_MS", 120_000),
      vtAuthPort: readPositiveInt(source, "VT_AUTH_PORT", 17_389),
    }),

    presence: Object.freeze({
      onlineMs: readPositiveInt(source, "PRESENCE_ONLINE_MS", 5 * 60_000),
      idleMs: readPositiveInt(source, "PRESENCE_IDLE_MS", 30 * 60_000),
      activityWindowMs: readPositiveInt(source, "PRESENCE_ACTIVITY_WINDOW_MS", 60_000),
      signalMinIntervalMs: readPositiveInt(source, "PRESENCE_SIGNAL_MIN_INTERVAL_MS", 60_000),
    }),
  });
}

/** @type {AppEnv | null} */
let cached = null;

/** Eager init — same as getEnv(). */
export function initConfig() {
  return getEnv();
}

/** Cached env snapshot (validates on first call). @returns {AppEnv} */
export function getEnv() {
  if (!cached) {
    cached = buildEnv(process.env);
  }
  return cached;
}

/** Redacted env for logs / health (no secrets). */
export function getPublicEnv() {
  return toPublicEnv(getEnv());
}

/** @internal Tests only — re-read process.env after mutations. */
export function __resetEnvForTests() {
  cached = null;
}

/** @type {typeof getEnv} */
export const env = getEnv;
