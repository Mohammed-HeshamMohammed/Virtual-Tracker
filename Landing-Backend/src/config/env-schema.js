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

      // Notify-Backend is the only persistence + delivery path for contact-form
      // inquiries — without these, /api/contact can never succeed in production.
      if (!(data.NOTIFY_BACKEND_URL || "").trim()) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["NOTIFY_BACKEND_URL"],
          message: "Production requires NOTIFY_BACKEND_URL (vt-notify-api persists and emails contact-form inquiries)",
        });
      }
      if (!(data.INTERNAL_SERVICE_SECRET || "").trim()) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["INTERNAL_SERVICE_SECRET"],
          message: "Production requires INTERNAL_SERVICE_SECRET (shared with vt-notify-api)",
        });
      }
      if (!(data.SUPPORT_EMAIL || "").trim()) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["SUPPORT_EMAIL"],
          message: "Production requires SUPPORT_EMAIL (recipient for contact-form inquiries)",
        });
      }
    }
  });

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
