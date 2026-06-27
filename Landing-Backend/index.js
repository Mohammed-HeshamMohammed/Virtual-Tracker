// Bootstrap: load and validate configuration before other modules run.
import { getEnv, initConfig } from "./src/config/env/index.js";

initConfig();

import { createServer } from "./src/server.js";
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { getDb } from "./src/core/database/firebase.js";
import { logStartup, logDbStatus, logError } from "./src/core/utils/logger.js";

let activeServer = null;

function resolvePort(rawPort) {
  const parsed = Number.parseInt(rawPort ?? "", 10);
  return Number.isFinite(parsed) ? parsed : getEnv().server.port;
}

function registerServerErrorHandler(server, port) {
  server.on("error", (err) => {
    if (err?.code === "EADDRINUSE") {
      console.error(`Port ${port} is already in use. Set PORT in Coolify environment variables.`);
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

export function startServer(port = getEnv().server.port, host = getEnv().server.host) {
  const server = createServer();
  activeServer = server;
  registerServerErrorHandler(server, port);

  server.listen(port, host, async () => {
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

    logStartup({
      version,
      port,
      nodeEnv: getEnv().nodeEnv,
      routes: ["/health"],
    });

    console.log(`Landing API listening on ${host}:${port} (${getEnv().nodeEnv})`);
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
