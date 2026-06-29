import { loadEnvFile } from "node:process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { validateEnvSource } from "./schema.js";
import { toPublicEnv } from "./public.js";

const BACKEND_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

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

/** @param {NodeJS.ProcessEnv} source */
function readCsv(source, key, fallback) {
  const raw = readString(source, key, "");
  if (!raw) return fallback;
  const items = raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return items.length ? items : fallback;
}

const DEFAULT_CORS_ORIGINS = [
  "http://localhost:3000",
  "http://127.0.0.1:3000",
  "http://localhost:3001",
  "http://127.0.0.1:3001",
];

/**
 * Parse process environment into a typed, frozen configuration object.
 * @param {NodeJS.ProcessEnv} [source]
 * @returns {AppEnv}
 */
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
      port: readPositiveInt(source, "PORT", 5713),
    }),

    security: Object.freeze({
      allowInsecureHttp: readBool(source, "ALLOW_INSECURE_HTTP", false),
      /** Dev-only TLS workaround for Firebase on Windows. */
      disableTlsVerificationInDev: !isProduction,
    }),

    cors: Object.freeze({
      origins: Object.freeze(readCsv(source, "CORS_ORIGINS", DEFAULT_CORS_ORIGINS)),
    }),

    urls: Object.freeze({
      frontendOrigin: readString(source, "FRONTEND_ORIGIN", "http://localhost:3000"),
      appPublicUrl: readString(source, "APP_PUBLIC_URL", ""),
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

    postgres: Object.freeze({
      url: readString(source, "POSTGRES_URL"),
    }),

    notify: Object.freeze({
      backendUrl: readString(source, "NOTIFY_BACKEND_URL", "http://localhost:5715"),
      internalServiceSecret: readString(source, "INTERNAL_SERVICE_SECRET"),
    }),

  });
}

/** @type {AppEnv | null} */
let cached = null;

/**
 * Load, parse, validate, and cache configuration. Safe to call multiple times.
 * @returns {AppEnv}
 */
export function initConfig() {
  return getEnv();
}

/**
 * Resolved configuration snapshot (parsed once per process unless reset for tests).
 * Validates on first access unless SKIP_ENV_VALIDATION=1.
 * @returns {AppEnv}
 */
export function getEnv() {
  if (!cached) {
    cached = buildEnv(process.env);
  }
  return cached;
}

/**
 * Redacted configuration safe for logs and health endpoints (no API keys or passwords).
 * @returns {ReturnType<typeof toPublicEnv>}
 */
export function getPublicEnv() {
  return toPublicEnv(getEnv());
}

/** @internal Tests only — re-read process.env after mutations. */
export function __resetEnvForTests() {
  cached = null;
}

/** @type {typeof getEnv} */
export const env = getEnv;
