/**
 * Zod schemas for environment validation.
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

const envSourceSchema = z
  .object({
    NODE_ENV: z.string().optional(),
    PORT: z.coerce.number().int().min(1).max(65535).optional(),
    ALLOW_INSECURE_HTTP: optionalTrimmedString,
    FRONTEND_ORIGIN: optionalTrimmedString,
    APP_PUBLIC_URL: optionalTrimmedString,
    DASHBOARD_BACKEND_URL: optionalTrimmedString,
    NOTIFY_BACKEND_URL: optionalTrimmedString,
    INTERNAL_SERVICE_SECRET: optionalTrimmedString,
    SUPPORT_EMAIL: optionalTrimmedString,
    FIREBASE_PROJECT_ID: optionalTrimmedString,
    FIREBASE_CLIENT_EMAIL: optionalTrimmedString,
    FIREBASE_PRIVATE_KEY: optionalTrimmedString,
    FIREBASE_SERVICE_ACCOUNT: optionalTrimmedString,
    GOOGLE_APPLICATION_CREDENTIALS: optionalTrimmedString,
    SKIP_ENV_VALIDATION: optionalTrimmedString,
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

    const clientEmail = data.FIREBASE_CLIENT_EMAIL;
    const privateKey = data.FIREBASE_PRIVATE_KEY;
    const adminPartial = Boolean(clientEmail || privateKey);
    if (adminPartial && (!clientEmail || !privateKey || !data.FIREBASE_PROJECT_ID)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["FIREBASE_CLIENT_EMAIL"],
        message: "FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, and FIREBASE_PRIVATE_KEY must all be set together",
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
