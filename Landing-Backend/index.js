// Landing-Backend entry: contact form + session-status proxy for the landing page.
import { getEnv, initConfig } from "./src/config/env.js";

initConfig();

import { createServer } from "./server.js";
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { logStartup, logError } from "./src/core/logger.js";

let activeServer = null;

function registerServerErrorHandler(server, port) {
  server.on("error", (err) => {
    if (err?.code === "EADDRINUSE") {
      console.error(
        `Port ${port} is already in use. Stop the other process or set PORT in Landing-Backend/.env.`,
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

  server.listen(port, () => {
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

    const routes = ["/health", "/api/contact", "/api/session-status", "/api/session-logout"];

    logStartup({
      version,
      port,
      nodeEnv: getEnv().nodeEnv,
      routes,
    });

    console.log(`Landing-Backend listening on http://localhost:${port}`);
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
