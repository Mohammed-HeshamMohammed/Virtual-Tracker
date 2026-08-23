// Bootstrap: load and validate configuration before other modules run.
import { getEnv, initConfig } from "./src/config/env.js";

const config = initConfig();

if (config.security.disableTlsVerificationInDev) {
  // Node.js Windows SSL workaround for Firebase Admin in local development only.
  process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
}

import { createServer } from "./server.js";
import { initPresenceGateway, broadcastToAll } from "./src/modules/presence/index.js";
import { subscribeChanges } from "./src/modules/realtime/change-bus.js";
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { getDb } from "./src/config/firebase.js";
import { logStartup, logDbStatus, logError } from "./src/core/logger.js";
import { scheduleOrganizationMaintenance } from "./src/bootstrap/entity-bootstrap.js";
import { ensurePostgresLookupSchema } from "./src/lib/postgres/ensure-lookup-schema.js";
import { backfillMemberAvatarUrls } from "./src/modules/auth/avatar-backfill.js";
import { cleanupCallingProjectTasks } from "./src/modules/projects/calling-project-task-cleanup.js";
import { scheduleTeamWeeklyReports } from "./src/modules/teams/team-weekly-report.service.js";
import { scheduleAbandonedSessionSweep } from "./src/modules/activity/abandoned-session-sweep.service.js";
import { scheduleReportDeliveries } from "./src/modules/reports/report-schedule-runner.js";
import { scheduleDataRetentionSweep } from "./src/modules/compliance/data-retention-sweep.service.js";
import { scheduleIntegritySweep } from "./src/modules/activity/integrity-sweep.service.js";
import { scheduleCounterReconciliationSweep } from "./src/modules/activity/counter-reconciliation-sweep.service.js";

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
    process.exit(1);
  });
}

// Last-resort process guards. Rejections from fire-and-forget work (schedulers,
// void-called services) have no request scope to catch them; without these Node
// would kill the process on a single Firestore blip.
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

export async function startServer(port = getEnv().server.port) {
  const server = createServer();
  initPresenceGateway(server);
  // Live sync (PLAN-livesyncandagenttimer.md §6.1): reuses the presence
  // gateway's socket set as the change-notification transport. One
  // subscription for the whole process lifetime, wired once here so every
  // publishChange() call anywhere in the app reaches every connected client.
  subscribeChanges((msg) => broadcastToAll({ type: "changed", ...msg }));
  activeServer = server;
  registerServerErrorHandler(server, port);

  const db = getDb();
  logDbStatus(!!db, db ? null : "Firebase Admin not initialized");
  if (db) {
    const schemaResult = await ensurePostgresLookupSchema();
    if (schemaResult.ok === false) {
      logError(new Error(schemaResult.error ?? "Postgres lookup schema ensure failed"), "postgres-lookup-schema");
    }
    backfillMemberAvatarUrls(db).catch((err) => logError(err, "avatar-backfill"));
    cleanupCallingProjectTasks().catch((err) => logError(err, "calling-project-task-cleanup"));
    scheduleOrganizationMaintenance(db, "server-startup");
    scheduleTeamWeeklyReports(db);
    scheduleAbandonedSessionSweep();
    scheduleReportDeliveries(db);
    scheduleDataRetentionSweep();
    scheduleIntegritySweep();
    scheduleCounterReconciliationSweep();
  }

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

    const routes = [
      "/health",
      "/api/readiness",
      // Auth-identity routes owned by Dashboard (NOT Auth-Backend)
      "/api/auth/sign-in-client-extras",
      "/api/auth/session-bootstrap",
      "/api/auth/complete-first-login",
      "/api/auth/profile",
      "/api/auth/access-request",
      "/api/auth/send-verification-email",
      "/api/auth/notify-*",
      // App / entity routes
      "/api/bootstrap",
      "/api/public/invites/*",
      "/api/members",
      "/api/member-roles",
      "/api/member-onboarding",
      "/api/member-relationships",
      "/api/projects",
      "/api/tasks",
      "/api/clients",
      "/api/teams",
      "/api/activity",
      "/api/presence",
      "/api/dashboard",
      "/api/notifications/*",
      // ⚠️ Restrict at gateway before first production deploy:
      "/monitor",
    ];

    logStartup({
      version,
      port,
      nodeEnv: getEnv().nodeEnv,
      routes,
    });

    console.log(`Dashboard-Backend listening on http://localhost:${port}`);
  });
  return server;
}

function isDirectExecution() {
  if (!process.argv[1]) return false;
  return import.meta.url === pathToFileURL(process.argv[1]).href;
}

if (isDirectExecution()) {
  void startServer();
}
