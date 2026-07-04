/**
 * Central environment configuration — single source of truth for Landing-Backend/.env values.
 *
 * Bootstrap: `loadEnvFile` runs once when this module is first imported.
 * Access: `import { getEnv, getPublicEnv, initConfig } from "./config/env.js"`
 *
 * Do not read `process.env` elsewhere in application code — use getEnv() from this module.
 *
 * @see Landing-Backend/.env.example
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
function readPositiveInt(source, key, fallback) {
  const raw = readString(source, key, "");
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
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

  return Object.freeze({
    nodeEnv,
    isProduction,
    isDevelopment: !isProduction,

    server: Object.freeze({
      port: readPositiveInt(source, "PORT", 5714),
    }),

    security: Object.freeze({
      allowInsecureHttp: readBool(source, "ALLOW_INSECURE_HTTP", false),
    }),

    urls: Object.freeze({
      frontendOrigin: readString(source, "FRONTEND_ORIGIN", "http://localhost:3001"),
      appPublicUrl: readString(source, "APP_PUBLIC_URL", ""),
    }),

    dashboard: Object.freeze({
      backendUrl: readString(source, "DASHBOARD_BACKEND_URL"),
    }),

    notify: Object.freeze({
      backendUrl: readString(source, "NOTIFY_BACKEND_URL"),
      internalServiceSecret: readString(source, "INTERNAL_SERVICE_SECRET"),
    }),

    email: Object.freeze({
      supportEmail: readString(source, "SUPPORT_EMAIL", "support@myvirtualtracker.com"),
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
