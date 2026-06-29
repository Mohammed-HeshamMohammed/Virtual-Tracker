/**
 * Zod schemas for environment and Firebase credential validation.
 * Fail-fast at startup — do not log parsed values (secrets).
 */

import { z } from "zod";

const nodeEnvSchema = z.enum(["development", "production", "test"]);

const httpsUrlSchema = z
  .string()
  .url()
  .refine((value) => value.startsWith("https://"), { message: "must be an https URL" });

const optionalTrimmedString = z
  .string()
  .optional()
  .transform((value) => (typeof value === "string" ? value.trim() : ""));

/** Firebase web client config (public — still validate shape). */
export const firebaseWebConfigSchema = z.object({
  apiKey: z.string().min(1, "apiKey is required"),
  authDomain: z.string().min(1, "authDomain is required"),
  projectId: z.string().min(1, "projectId is required"),
  storageBucket: z.string().optional().default(""),
  messagingSenderId: z.string().optional().default(""),
  appId: z.string().min(1, "appId is required"),
  measurementId: z.string().optional().default(""),
});

/** Firebase Admin service account JSON (private). */
export const firebaseServiceAccountSchema = z.object({
  type: z.literal("service_account"),
  project_id: z.string().min(1),
  private_key_id: z.string().optional(),
  private_key: z.string().min(1),
  client_email: z.string().email(),
  client_id: z.string().optional(),
  auth_uri: z.string().url().optional(),
  token_uri: z.string().url().optional(),
  auth_provider_x509_cert_url: z.string().url().optional(),
  client_x509_cert_url: z.string().url().optional(),
  universe_domain: z.string().optional(),
});

/** Web Push VAPID public key (URL-safe base64). */
export const vapidPublicKeySchema = z
  .string()
  .min(80, "VAPID public key is too short")
  .max(120, "VAPID public key is too long")
  .regex(/^[A-Za-z0-9_-]+$/, "VAPID public key must be URL-safe base64");

const envSourceSchema = z
  .object({
    NODE_ENV: z.string().optional(),
    PORT: z.coerce.number().int().min(1).max(65535).optional(),
    ALLOW_INSECURE_HTTP: optionalTrimmedString,
    NODE_TLS_REJECT_UNAUTHORIZED: optionalTrimmedString,
    FRONTEND_ORIGIN: optionalTrimmedString,
    APP_PUBLIC_URL: optionalTrimmedString,
    CORS_ORIGINS: optionalTrimmedString,
    FIREBASE_API_KEY: optionalTrimmedString,
    FIREBASE_AUTH_DOMAIN: optionalTrimmedString,
    FIREBASE_PROJECT_ID: optionalTrimmedString,
    FIREBASE_STORAGE_BUCKET: optionalTrimmedString,
    FIREBASE_MESSAGING_SENDER_ID: optionalTrimmedString,
    FIREBASE_APP_ID: optionalTrimmedString,
    FIREBASE_MEASUREMENT_ID: optionalTrimmedString,
    FIREBASE_WEB_PUSH_VAPID_PUBLIC_KEY: optionalTrimmedString,
    FIREBASE_CLIENT_EMAIL: optionalTrimmedString,
    FIREBASE_PRIVATE_KEY: optionalTrimmedString,
    FIREBASE_PRIVATE_KEY_ID: optionalTrimmedString,
    GOOGLE_APPLICATION_CREDENTIALS: optionalTrimmedString,
    FIREBASE_SERVICE_ACCOUNT: optionalTrimmedString,
    RESEND_API_KEY: optionalTrimmedString,
    RESEND_FROM: optionalTrimmedString,
    SMTP_HOST: optionalTrimmedString,
    SMTP_PORT: optionalTrimmedString,
    SMTP_SECURE: optionalTrimmedString,
    SMTP_USER: optionalTrimmedString,
    SMTP_PASS: optionalTrimmedString,
    SMTP_FROM: optionalTrimmedString,
    INVITE_SHARE_LINK_TTL_HOURS: optionalTrimmedString,
    MONITOR_USERNAME: optionalTrimmedString,
    MONITOR_PASSWORD: optionalTrimmedString,
    ACTIVITY_CAPTURE_MODE: optionalTrimmedString,
    ACTIVITY_WEB_CAPTURE_ENABLED: optionalTrimmedString,
    ACTIVITY_TASK_SCREENSHOTS_ENABLED: optionalTrimmedString,
    ACTIVITY_DESKTOP_AGENT_INGEST_ENABLED: optionalTrimmedString,
    ACTIVITY_SESSION_STALE_MS: optionalTrimmedString,
    VT_AUTH_PORT: optionalTrimmedString,
    PRESENCE_ONLINE_MS: optionalTrimmedString,
    PRESENCE_IDLE_MS: optionalTrimmedString,
    PRESENCE_ACTIVITY_WINDOW_MS: optionalTrimmedString,
    PRESENCE_SIGNAL_MIN_INTERVAL_MS: optionalTrimmedString,
    FIREBASE_DATABASE_URL: optionalTrimmedString,
    SKIP_ENV_VALIDATION: optionalTrimmedString,
    // Internal service auth — used when vt-notify-api is live
    NOTIFY_BACKEND_URL: optionalTrimmedString,
    INTERNAL_SERVICE_SECRET: optionalTrimmedString,
    AUTH_BACKEND_URL: optionalTrimmedString,
    GCS_BUCKET_NAME: optionalTrimmedString,
    POSTGRES_URL: optionalTrimmedString,
  })
  .superRefine((data, ctx) => {
    const nodeEnvRaw = (data.NODE_ENV || "development").trim();
    const nodeEnvResult = nodeEnvSchema.safeParse(nodeEnvRaw);
    if (!nodeEnvResult.success) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["NODE_ENV"],
        message: `NODE_ENV must be one of: ${nodeEnvSchema.options.join(", ")}`,
      });
      return;
    }
    const nodeEnv = nodeEnvResult.data;
    const isProduction = nodeEnv === "production";

    if (isProduction) {
      const publicUrl = (data.APP_PUBLIC_URL || data.FRONTEND_ORIGIN || "").trim();
      if (!publicUrl) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["APP_PUBLIC_URL"],
          message: "Production requires APP_PUBLIC_URL or FRONTEND_ORIGIN to be set",
        });
      } else if (!httpsUrlSchema.safeParse(publicUrl).success) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["APP_PUBLIC_URL"],
          message: "Production requires APP_PUBLIC_URL or FRONTEND_ORIGIN to be an https URL",
        });
      }
    }

    const firebaseWebFields = [
      data.FIREBASE_API_KEY,
      data.FIREBASE_AUTH_DOMAIN,
      data.FIREBASE_PROJECT_ID,
      data.FIREBASE_STORAGE_BUCKET,
      data.FIREBASE_MESSAGING_SENDER_ID,
      data.FIREBASE_APP_ID,
      data.FIREBASE_MEASUREMENT_ID,
    ];
    const anyFirebaseWeb = firebaseWebFields.some((value) => Boolean(value));
    const requiredFirebaseWeb = [data.FIREBASE_API_KEY, data.FIREBASE_AUTH_DOMAIN, data.FIREBASE_PROJECT_ID, data.FIREBASE_APP_ID];
    const allRequiredFirebaseWeb = requiredFirebaseWeb.every((value) => Boolean(value));
    if (anyFirebaseWeb && !allRequiredFirebaseWeb) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["FIREBASE_API_KEY"],
        message:
          "When any Firebase web variable is set, FIREBASE_API_KEY, FIREBASE_AUTH_DOMAIN, FIREBASE_PROJECT_ID, and FIREBASE_APP_ID are all required",
      });
    }

    if (allRequiredFirebaseWeb) {
      const webResult = firebaseWebConfigSchema.safeParse({
        apiKey: data.FIREBASE_API_KEY,
        authDomain: data.FIREBASE_AUTH_DOMAIN,
        projectId: data.FIREBASE_PROJECT_ID,
        storageBucket: data.FIREBASE_STORAGE_BUCKET || undefined,
        messagingSenderId: data.FIREBASE_MESSAGING_SENDER_ID || undefined,
        appId: data.FIREBASE_APP_ID,
        measurementId: data.FIREBASE_MEASUREMENT_ID || undefined,
      });
      if (!webResult.success) {
        for (const issue of webResult.error.issues) {
          ctx.addIssue({
            ...issue,
            path: ["FIREBASE_API_KEY", ...issue.path],
          });
        }
      }
    }

    const vapidKey = data.FIREBASE_WEB_PUSH_VAPID_PUBLIC_KEY;
    if (vapidKey) {
      const vapidResult = vapidPublicKeySchema.safeParse(vapidKey);
      if (!vapidResult.success) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["FIREBASE_WEB_PUSH_VAPID_PUBLIC_KEY"],
          message: vapidResult.error.issues[0]?.message ?? "Invalid VAPID public key",
        });
      }
    }

    const smtpHost = data.SMTP_HOST;
    const smtpUser = data.SMTP_USER;
    const smtpPass = data.SMTP_PASS;
    const smtpPartial = Boolean(smtpHost || smtpUser || smtpPass);
    if (smtpPartial && (!smtpHost || !smtpUser || !smtpPass)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["SMTP_HOST"],
        message: "SMTP_HOST, SMTP_USER, and SMTP_PASS must all be set together",
      });
    }

    const clientEmail = data.FIREBASE_CLIENT_EMAIL;
    const privateKey = data.FIREBASE_PRIVATE_KEY;
    const adminPartial = Boolean(clientEmail || privateKey);
    if (adminPartial && (!clientEmail || !privateKey)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["FIREBASE_CLIENT_EMAIL"],
        message: "FIREBASE_CLIENT_EMAIL and FIREBASE_PRIVATE_KEY must both be set",
      });
    }

    const serviceAccountRaw = data.FIREBASE_SERVICE_ACCOUNT;
    if (serviceAccountRaw) {
      try {
        parseFirebaseServiceAccountJson(serviceAccountRaw);
      } catch (error) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["FIREBASE_SERVICE_ACCOUNT"],
          message: error instanceof Error ? error.message : "Invalid FIREBASE_SERVICE_ACCOUNT JSON",
        });
      }
    }

    if (isProduction) {
      const notifyUrl = (data.NOTIFY_BACKEND_URL || "").trim();
      if (!notifyUrl) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["NOTIFY_BACKEND_URL"],
          message: "Production requires NOTIFY_BACKEND_URL (vt-notify-api handles outbound email)",
        });
      }
    }
  });

/**
 * @param {unknown} raw
 * @returns {z.infer<typeof firebaseServiceAccountSchema>}
 */
export function parseFirebaseServiceAccountJson(raw) {
  const value = typeof raw === "string" ? JSON.parse(raw.trim()) : raw;
  return firebaseServiceAccountSchema.parse(value);
}

/**
 * @param {unknown} raw
 * @returns {z.infer<typeof firebaseWebConfigSchema>}
 */
export function parseFirebaseWebConfigJson(raw) {
  const value = typeof raw === "string" ? JSON.parse(raw) : raw;
  return firebaseWebConfigSchema.parse(value);
}

/**
 * @param {Record<string, string | undefined>} source
 * @returns {string[]}
 */
export function collectEnvValidationErrors(source = process.env) {
  const result = envSourceSchema.safeParse(source);
  if (result.success) return [];
  return formatZodIssues(result.error);
}

/**
 * @param {Record<string, string | undefined>} source
 */
export function validateEnvSource(source = process.env) {
  const errors = collectEnvValidationErrors(source);
  if (errors.length > 0) {
    throw new Error(`Invalid environment configuration:\n${errors.map((line) => `  - ${line}`).join("\n")}`);
  }
}

/** @deprecated Use validateEnvSource — kept for tests that validated built config. */
export function validateEnv(source = process.env) {
  validateEnvSource(source);
}

/**
 * @param {import("zod").ZodError} error
 * @returns {string[]}
 */
function formatZodIssues(error) {
  return error.issues.map((issue) => {
    const path = issue.path.length > 0 ? `${issue.path.join(".")}: ` : "";
    return `${path}${issue.message}`;
  });
}
