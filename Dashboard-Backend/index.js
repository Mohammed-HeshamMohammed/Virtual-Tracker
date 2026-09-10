import { getEnv, initConfig } from "./src/config/env.js";

const config = initConfig();

if (config.security.disableTlsVerificationInDev) {
  // Loud on purpose: this disables certificate validation for every outbound
  // request in this process. It needs DISABLE_TLS_VERIFY=true *and* a
  // non-production NODE_ENV, so it cannot switch itself on by accident - but
  // if it is ever on in a deployed environment, the log is how you find out.
  console.warn(
    "[security] TLS certificate verification is DISABLED (DISABLE_TLS_VERIFY=true, NODE_ENV=%s). Never use this in production.",
    config.nodeEnv,
  );
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
import { backfillMemberDisplayNames } from "./src/modules/members/services/member-name-backfill.js";
import { cleanupCallingProjectTasks } from "./src/modules/projects/calling-project-task-cleanup.js";
import { scheduleTeamWeeklyReports } from "./src/modules/teams/team-weekly-report.service.js";
import { scheduleAbandonedSessionSweep } from "./src/modules/activity/abandoned-session-sweep.service.js";
import { scheduleReportDeliveries } from "./src/modules/reports/report-schedule-runner.js";
import { scheduleCurrencyRateRefresh } from "./src/lib/currency/rate-fetcher.js";
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

process.on("unhandledRejection", (reason) => {
  logError(reason instanceof Error ? reason : new Error(String(reason)), "unhandledRejection");
});
process.on("uncaughtException", (err) => {
  logError(err, "uncaughtException");
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

export async function startServer(port = getEnv().server.port) {
  const server = createServer();
  initPresenceGateway(server);
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
    backfillMemberDisplayNames().catch((err) => logError(err, "member-name-backfill"));
    cleanupCallingProjectTasks().catch((err) => logError(err, "calling-project-task-cleanup"));
    scheduleOrganizationMaintenance(db, "server-startup");
    scheduleTeamWeeklyReports(db);
    scheduleAbandonedSessionSweep();
    scheduleReportDeliveries(db);
    scheduleCurrencyRateRefresh();
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
      "/api/auth/sign-in-client-extras",
      "/api/auth/session-bootstrap",
      "/api/auth/complete-first-login",
      "/api/auth/profile",
      "/api/auth/access-request",
      "/api/auth/send-verification-email",
      "/api/auth/notify-*",
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
