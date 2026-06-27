// Bootstrap: load and validate configuration before other modules run.
import { getEnv, initConfig } from "./src/config/env/index.js";

const config = initConfig();

if (config.security.disableTlsVerificationInDev) {
  // Node.js Windows SSL workaround for Firebase Admin in local development only.
  process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
}

import { createServer } from "./src/server.js";
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { getDb } from "./src/core/database/firebase.js";
import { logStartup, logDbStatus, logError } from "./src/core/utils/logger.js";
import { logEmailDeliveryStatusAsync } from "./src/modules/auth/email/email-config.js";

let activeServer = null;

function resolvePort(rawPort) {
  const parsed = Number.parseInt(rawPort ?? "", 10);
  return Number.isFinite(parsed) ? parsed : getEnv().server.port;
}

function registerServerErrorHandler(server, port) {
  server.on("error", (err) => {
    if (err?.code === "EADDRINUSE") {
      console.error(
        `Port ${port} is already in use. Stop the other process or set PORT in Auth-Backend/.env, e.g.:` +
          `\n  $env:PORT=5712; npm start`,
      );
      process.exit(1);
    }
    logError(err, "server");
    throw err;
  });
}

// Graceful shutdown
process.on("SIGTERM", () => {
  console.log("\n[shutdown] SIGTERM received, closing server...");
  if (activeServer) {
    activeServer.close(() => process.exit(0));
    return;
  }
  process.exit(0);
});
process.on("SIGINT", () => {
  console.log("\n[shutdown] SIGINT received, closing server...");
  if (activeServer) {
    activeServer.close(() => process.exit(0));
    return;
  }
  process.exit(0);
});

export function startServer(port = getEnv().server.port) {
  const server = createServer();
  activeServer = server;
  registerServerErrorHandler(server, port);

  server.listen(port, async () => {
    const db = getDb();
    logDbStatus(!!db, db ? null : "Firebase Admin not initialized");

    let version = "0.0.0";
    try {
      const pkgPath = new URL("./package.json", import.meta.url);
      const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
      if (typeof pkg.version === "string" && pkg.version.trim()) {
        version = pkg.version;
      }
    } catch {
      // Keep default version fallback.
    }

    const routes = [
      "/health",
      "/api/auth/complete-first-login",
      "/api/auth/notify-password-changed",
      "/api/auth/notify-password-reset",
      "/api/auth/notify-email-verified",
      "/api/auth/promote-pending-member",
      "/api/auth/password-policy",
      "/api/auth/readiness",
      "/api/auth/validate-password",
      "/api/auth/firebase-config",
      "/api/auth/send-verification-email",
      "/api/auth/verify",
      "/api/auth/profile",
      "/api/auth/profile-avatar",
      "/api/auth/resolve-sign-in-methods",
      "/api/auth/check-email",
      "/api/auth/phone-verification/send",
      "/api/auth/phone-verification/confirm",
      "/api/auth/phone-verification/exchange",
      "/api/auth/deactivation-request",
      "/api/auth/deactivation-requests",
      "/api/auth/deactivation-requests/:id/approve",
      "/api/auth/deactivation-requests/:id/reject",
      "/api/auth/delete-account",
    ];

    logStartup({
      version,
      port,
      nodeEnv: getEnv().nodeEnv,
      routes,
    });

    await logEmailDeliveryStatusAsync();

    console.log(`Auth API server listening on http://localhost:${port}`);
  });
  return server;
}

function isDirectExecution() {
  if (!process.argv[1]) return false;
  return import.meta.url === pathToFileURL(process.argv[1]).href;
}

if (isDirectExecution()) {
  startServer();
}
