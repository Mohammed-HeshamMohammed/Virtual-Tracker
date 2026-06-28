// Notify-Backend — outbound messaging service (vt-notify-api)
// Internal only. No public browser access — called exclusively by vt-dashboard-api.

import { initConfig, getEnv } from "./src/config/env.js";

const config = initConfig();

import { createServer } from "./server.js";
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { initFirebaseAdmin } from "./src/config/firebase.js";
import { logStartup, logError } from "./src/core/logger.js";
import { logEmailDeliveryStatusAsync } from "./src/modules/email/email-config.js";

let activeServer = null;

function registerServerErrorHandler(server, port) {
  server.on("error", (err) => {
    if (err?.code === "EADDRINUSE") {
      console.error(
        `Port ${port} is already in use. Stop the other process or set PORT in Notify-Backend/.env.`,
      );
      process.exit(1);
    }
    logError(err, "server");
    throw err;
  });
}

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
      "/api/notify/readiness",
      "/api/notify/email",
      "/api/notify/otp/send",
      "/api/notify/otp/verify",
      "/api/notify/otp/exchange",
      "/api/notify/push",
    ];

    logStartup({ version, port, nodeEnv: getEnv().nodeEnv, routes });

    await logEmailDeliveryStatusAsync();

    const fcmReady = await initFirebaseAdmin();
    if (fcmReady) {
      const timestamp = new Date().toISOString();
      console.log(`[${timestamp}] \x1b[32m✓\x1b[0m Firebase Admin initialized — FCM push ready`);
    }

    console.log(`Notify-Backend listening on http://localhost:${port}`);
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
