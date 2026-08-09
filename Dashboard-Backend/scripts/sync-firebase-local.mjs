#!/usr/bin/env node
/**
 * Validates local Firebase JSON files and prints matching .env lines (no secrets written to disk).
 *
 * Usage:
 *   1. Copy firebase-web.local.json.example → firebase-web.local.json and paste web config
 *   2. Copy firebase-admin.local.json.example → firebase-admin.local.json and paste service account
 *   3. npm run sync:firebase-local
 *
 * Paste printed lines into Backend/.env (gitignored). Never commit real credentials.
 */

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  firebaseServiceAccountSchema,
  firebaseWebConfigSchema,
  vapidPublicKeySchema,
} from "../src/config/env-schema.js";

const backendRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const webPath = path.join(backendRoot, "firebase-web.local.json");
const adminPath = path.join(backendRoot, "firebase-admin.local.json");

function readJson(filePath) {
  if (!existsSync(filePath)) return null;
  try {
    return JSON.parse(readFileSync(filePath, "utf8"));
  } catch (error) {
    console.error(`Failed to parse ${path.basename(filePath)}:`, error instanceof Error ? error.message : error);
    process.exit(1);
  }
}

let failed = false;

const webRaw = readJson(webPath);
if (webRaw) {
  const result = firebaseWebConfigSchema.safeParse(webRaw);
  if (!result.success) {
    failed = true;
    console.error("\nfirebase-web.local.json validation failed:");
    for (const issue of result.error.issues) {
      console.error(`  - ${issue.path.join(".")}: ${issue.message}`);
    }
  } else {
    const w = result.data;
    console.log("\n# Firebase web — paste into Backend/.env");
    console.log(`FIREBASE_API_KEY=${w.apiKey}`);
    console.log(`FIREBASE_AUTH_DOMAIN=${w.authDomain}`);
    console.log(`FIREBASE_PROJECT_ID=${w.projectId}`);
    if (w.storageBucket) console.log(`FIREBASE_STORAGE_BUCKET=${w.storageBucket}`);
    if (w.messagingSenderId) console.log(`FIREBASE_MESSAGING_SENDER_ID=${w.messagingSenderId}`);
    console.log(`FIREBASE_APP_ID=${w.appId}`);
    if (w.measurementId) console.log(`FIREBASE_MEASUREMENT_ID=${w.measurementId}`);
  }
} else {
  console.warn("firebase-web.local.json not found — copy from firebase-web.local.json.example");
}

const adminRaw = readJson(adminPath);
if (adminRaw) {
  const result = firebaseServiceAccountSchema.safeParse(adminRaw);
  if (!result.success) {
    failed = true;
    console.error("\nfirebase-admin.local.json validation failed:");
    for (const issue of result.error.issues) {
      console.error(`  - ${issue.path.join(".")}: ${issue.message}`);
    }
  } else {
    console.log("\n# Firebase admin — firebase-admin.local.json is already valid (preferred).");
    console.log("# Or paste into Backend/.env as a single line:");
    console.log(`# FIREBASE_SERVICE_ACCOUNT=${JSON.stringify(adminRaw)}`);
  }
} else {
  console.warn("firebase-admin.local.json not found — copy from firebase-admin.local.json.example");
}

const vapidFromEnv = process.env.FIREBASE_WEB_PUSH_VAPID_PUBLIC_KEY?.trim();
if (vapidFromEnv) {
  const vapidResult = vapidPublicKeySchema.safeParse(vapidFromEnv);
  if (!vapidResult.success) {
    failed = true;
    console.error("\nFIREBASE_WEB_PUSH_VAPID_PUBLIC_KEY in environment is invalid.");
  }
}

if (failed) process.exit(1);
console.log("\nDone. Rotate any credentials that were exposed outside .env.");
