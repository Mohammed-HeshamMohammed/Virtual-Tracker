/**
 * Environment configuration for Notify-Backend.
 * Fail-fast at startup — do not log parsed values (secrets).
 */
import { z } from "zod";

const optionalTrimmedString = z
  .string()
  .optional()
  .transform((v) => (typeof v === "string" ? v.trim() : ""));

const envSchema = z
  .object({
    NODE_ENV: z.string().optional(),
    PORT: z.coerce.number().int().min(1).max(65535).optional(),

    // CORS — only vt-dashboard-api should call this service
    FRONTEND_ORIGIN: optionalTrimmedString,
    CORS_ORIGINS: optionalTrimmedString,

    // Internal auth — requests from vt-dashboard-api must carry this secret
    INTERNAL_SERVICE_SECRET: optionalTrimmedString,

    // Email delivery — SMTP only
    SMTP_HOST: optionalTrimmedString,
    SMTP_PORT: optionalTrimmedString,
    SMTP_SECURE: optionalTrimmedString,
    SMTP_USER: optionalTrimmedString,
    SMTP_PASS: optionalTrimmedString,
    SMTP_FROM: optionalTrimmedString,

    // Firebase Admin — required for FCM push notifications
    FIREBASE_PROJECT_ID: optionalTrimmedString,
    FIREBASE_CLIENT_EMAIL: optionalTrimmedString,
    FIREBASE_PRIVATE_KEY: optionalTrimmedString,
    FIREBASE_SERVICE_ACCOUNT: optionalTrimmedString,
    GOOGLE_APPLICATION_CREDENTIALS: optionalTrimmedString,

    // OTP / phone — dev mode logs code to console instead of sending SMS
    PHONE_VERIFICATION_DEV_MODE: optionalTrimmedString,
  })
  .superRefine((data, ctx) => {
    const nodeEnv = (data.NODE_ENV || "development").trim();
    const isProduction = nodeEnv === "production";

    if (isProduction) {
      if (!data.INTERNAL_SERVICE_SECRET) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["INTERNAL_SERVICE_SECRET"],
          message: "Production requires INTERNAL_SERVICE_SECRET to be set",
        });
      }
      const smtpConfigured = Boolean(data.SMTP_HOST && data.SMTP_USER && data.SMTP_PASS);
      if (!smtpConfigured) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["SMTP_HOST"],
          message: "Production requires SMTP_HOST, SMTP_USER, and SMTP_PASS",
        });
      }
    }

    const smtpPartial = Boolean(data.SMTP_HOST || data.SMTP_USER || data.SMTP_PASS);
    if (smtpPartial && (!data.SMTP_HOST || !data.SMTP_USER || !data.SMTP_PASS)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["SMTP_HOST"],
        message: "SMTP_HOST, SMTP_USER, and SMTP_PASS must all be set together",
      });
    }
  });

/** @type {ReturnType<typeof buildConfig> | null} */
let _config = null;

function buildConfig(source = process.env) {
  const nodeEnv = (source.NODE_ENV || "development").trim();
  const isProduction = nodeEnv === "production";
  const port = Number.parseInt(source.PORT ?? "", 10);

  return {
    nodeEnv,
    isProduction,
    server: {
      port: Number.isFinite(port) ? port : 5715,
    },
    security: {
      internalServiceSecret: source.INTERNAL_SERVICE_SECRET || "",
    },
    cors: {
      frontendOrigin: source.FRONTEND_ORIGIN || "",
      corsOrigins: source.CORS_ORIGINS || "",
    },
    email: {
      smtpHost: source.SMTP_HOST || "",
      smtpPort: Number.parseInt(source.SMTP_PORT ?? "587", 10),
      smtpSecure: source.SMTP_SECURE === "true",
      smtpUser: source.SMTP_USER || "",
      smtpPass: source.SMTP_PASS || "",
      smtpFrom: source.SMTP_FROM || "",
    },
    firebase: {
      projectId: source.FIREBASE_PROJECT_ID || "",
      clientEmail: source.FIREBASE_CLIENT_EMAIL || "",
      privateKey: source.FIREBASE_PRIVATE_KEY || "",
      serviceAccount: source.FIREBASE_SERVICE_ACCOUNT || "",
      applicationCredentials: source.GOOGLE_APPLICATION_CREDENTIALS || "",
    },
    phoneVerification: {
      devMode: source.PHONE_VERIFICATION_DEV_MODE === "true",
    },
  };
}

export function initConfig(source = process.env) {
  const result = envSchema.safeParse(source);
  if (!result.success) {
    const lines = result.error.issues.map((i) => `  - ${i.path.join(".")}: ${i.message}`);
    throw new Error(`Invalid environment configuration:\n${lines.join("\n")}`);
  }
  _config = buildConfig(source);
  return _config;
}

export function getEnv() {
  if (!_config) throw new Error("getEnv() called before initConfig()");
  return _config;
}
