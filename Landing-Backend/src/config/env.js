
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


function readString(source, key, fallback = "") {
  const raw = source[key];
  if (typeof raw !== "string") return fallback;
  const trimmed = raw.trim();
  return trimmed || fallback;
}

function readPositiveInt(source, key, fallback) {
  const raw = readString(source, key, "");
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function readBool(source, key, defaultWhenUnset) {
  const raw = readString(source, key, "");
  if (!raw) return defaultWhenUnset;
  const lower = raw.toLowerCase();
  if (lower === "true" || lower === "1" || lower === "yes") return true;
  if (lower === "false" || lower === "0" || lower === "no") return false;
  return defaultWhenUnset;
}

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

    github: Object.freeze({
      pat: readString(source, "GITHUB_PAT"),
      repoOwner: readString(source, "GITHUB_REPO_OWNER", "Mohammed-HeshamMohammed"),
      repoName: readString(source, "GITHUB_REPO_NAME", "Virtual-Tracker"),
    }),
  });
}

let cached = null;

export function initConfig() {
  return getEnv();
}

export function getEnv() {
  if (!cached) {
    cached = buildEnv(process.env);
  }
  return cached;
}

export function getPublicEnv() {
  return toPublicEnv(getEnv());
}

export function __resetEnvForTests() {
  cached = null;
}

export const env = getEnv;
