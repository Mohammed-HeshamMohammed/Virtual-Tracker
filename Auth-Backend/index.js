// Auth-Backend entry: Firebase authentication API.
import { getEnv, initConfig } from "./src/config/env.js";

const config = initConfig();

if (config.security.disableTlsVerificationInDev) {
  process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
}

import { createServer } from "./server.js";
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { getDb } from "./src/config/firebase.js";
import { logStartup, logDbStatus, logError } from "./src/core/logger.js";

let activeServer = null;

function registerServerErrorHandler(server, port) {
  server.on("error", (err) => {
    if (err?.code === "EADDRINUSE") {
      console.error(
        `Port ${port} is already in use. Stop the other process or set PORT in Auth-Backend/.env.`,
      );
      process.exit(1);
    }
    logError(err, "server");
    process.exit(1);
  });
}

// Last-resort process guards. Rejections outside the request path (Firebase
// init, timers) have nothing else to catch them.
process.on("unhandledRejection", (reason) => {
  logError(reason instanceof Error ? reason : new Error(String(reason)), "unhandledRejection");
});
process.on("uncaughtException", (err) => {
  logError(err, "uncaughtException");
  // State is unknown after an uncaught throw: stop taking traffic and let the
  // supervisor restart us.
  if (activeServer) {
    activeServer.close(() => process.exit(1));
    setTimeout(() => process.exit(1), 5000).unref();
    return;
  }
  process.exit(1);
});

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
      "/api/auth/firebase-config",
      "/api/auth/readiness",
      "/api/auth/password-policy",
      "/api/auth/validate-password",
      "/api/auth/verify",
      "/api/auth/resolve-sign-in-methods",
    ];

    logStartup({
      version,
      port,
      nodeEnv: getEnv().nodeEnv,
      routes,
    });

    const db = getDb();
    logDbStatus(!!db, db ? null : "Firebase Admin not initialized");

    console.log(`Auth-Backend listening on http://localhost:${port}`);
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
