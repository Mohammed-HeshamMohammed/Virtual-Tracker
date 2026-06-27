// Bootstrap: load and validate configuration before other modules run.
import { getEnv, initConfig } from "./src/config/env.js";

const config = initConfig();

if (config.security.disableTlsVerificationInDev) {
  // Node.js Windows SSL workaround for Firebase Admin in local development only.
  process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
}

import { createServer } from "./server.js";
import { initPresenceGateway } from "./src/modules/presence/index.js";
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { getDb } from "./src/config/firebase.js";
import { logStartup, logDbStatus, logError } from "./src/core/logger.js";
import { scheduleOrganizationMaintenance } from "./src/bootstrap/entity-bootstrap.js";
import { removeProjectOfficeMemberRoles } from "./src/modules/projects/migrate-remove-office-member-roles.js";
import { scheduleTeamWeeklyReports } from "./src/modules/teams/team-weekly-report.service.js";
import { logEmailDeliveryStatusAsync } from "./src/modules/auth/email-config.js";

let activeServer = null;

function resolvePort(rawPort) {
  const parsed = Number.parseInt(rawPort ?? "", 10);
  return Number.isFinite(parsed) ? parsed : getEnv().server.port;
}

function registerServerErrorHandler(server, port) {
  server.on("error", (err) => {
    if (err?.code === "EADDRINUSE") {
      console.error(
        `Port ${port} is already in use. Stop the other process or set PORT in Dashboard-Backend/.env, e.g.:` +
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
  initPresenceGateway(server);
  activeServer = server;
  registerServerErrorHandler(server, port);

  server.listen(port, async () => {
    const db = getDb();
    logDbStatus(!!db, db ? null : "Firebase Admin not initialized");
    if (db) {
      scheduleOrganizationMaintenance(db, "server-startup");
      scheduleTeamWeeklyReports(db);
      removeProjectOfficeMemberRoles().catch((err) => {
        logError(err, "project-office-member-roles-migration");
      });
    }

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
      "/api/members",
      "/api/roles",
      "/api/member-roles",
      "/api/member-onboarding",
      "/api/member-relationships",
      "/api/invites",
      "/api/invite-projects",
      "/api/job-titles",
      "/api/departments",
      "/api/job-types",
      "/api/tax-types",
      "/api/employment",
      "/api/clients",
      "/api/client-budgets",
      "/api/client-invoicing",
      "/api/client-projects",
      "/api/projects",
      "/api/project-members",
      "/api/project-budgets",
      "/api/project-member-limits",
      "/api/tasks",
      "/api/task-comments",
      "/api/task-attachments",
      "/api/teams",
      "/api/team-members",
      "/api/team-projects",
      "/api/pay-rates",
      "/api/time-settings",
      "/api/limits",
    ];

    logStartup({
      version,
      port,
      nodeEnv: getEnv().nodeEnv,
      routes,
    });

    await logEmailDeliveryStatusAsync();

    console.log(`Dashboard-Backend listening on http://localhost:${port}`);
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
