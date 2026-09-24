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
import { ensureTenancySchema, runHighVolumeTenancyMigrations } from "./src/lib/postgres/ensure-tenancy-schema.js";
import { ensureTenancyRls } from "./src/lib/postgres/ensure-tenancy-rls.js";
import { getTenancyIsolationReport } from "./src/lib/postgres/verify-tenancy-isolation.js";
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
    // Runs after the lookup schema above: it ALTERs tables the lookup schema
    // just created/ensured, and its own audit-trigger replacement depends on
    // audit_logs already having its tenant_id column (see
    // ensure-tenancy-schema.js's AUDIT_TRIGGER_DDL comment).
    const tenancyResult = await ensureTenancySchema();
    if (tenancyResult.ok === false) {
      logError(new Error(tenancyResult.error ?? "Postgres tenancy schema ensure failed"), "postgres-tenancy-schema");
    } else {
      // Fire-and-forget: CONCURRENTLY builds and VALIDATE CONSTRAINT scans on
      // the high-volume tables take real time on a populated database and
      // must not delay the server coming up. A miss just means another pass
      // next boot - see the function's own comment.
      runHighVolumeTenancyMigrations().catch((err) => logError(err, "tenancy-high-volume-migration"));
    }
    // Inert unless POSTGRES_TENANCY_RLS_ENABLED=true - see that flag's own
    // comment in ensure-tenancy-rls.js.
    const rlsResult = await ensureTenancyRls();
    if (rlsResult.ok === false) {
      logError(new Error(rlsResult.error ?? "Postgres tenancy RLS ensure failed"), "postgres-tenancy-rls");
    }
    // Checks what the database is actually doing rather than what the two
    // migrations above reported, because a policy that exists and a policy
    // that applies are different things - see verify-tenancy-isolation.js.
    const isolation = await getTenancyIsolationReport({ refresh: true });
    if (isolation.critical) {
      logError(new Error(isolation.summary), "tenant-isolation");
      for (const reason of isolation.reasons) logError(new Error(reason), "tenant-isolation");
    } else {
      console.log(`[tenancy] isolation ${isolation.status}: ${isolation.summary}`);
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
