import { getEnv } from "../../config/env.js";
import { currentTenantId } from "./audit-actor.js";
import { TENANT_SCOPED_TABLES, TENANT_SCOPED_VIEWS } from "./tenancy-tables.js";

/**
 * POSTGRES_TENANCY_AUDIT=true: reports every ordinary-pool query that reads
 * or writes tenant data while no tenant is published. Under enforcement
 * those are exactly the queries that would silently see nothing (or fail
 * WITH CHECK), so running this against real traffic BEFORE enforcing is how
 * the call sites that code reading missed get found.
 *
 * Deliberately log-only and off by default: it never changes a query, and
 * it never looks at the admin pool, whose whole purpose is to run without a
 * tenant. One line per distinct call site, capped, so a hot path cannot
 * flood the logs.
 */

const NAMES = [
  ...TENANT_SCOPED_TABLES.map((e) => (typeof e === "string" ? e : e.name)),
  ...TENANT_SCOPED_VIEWS,
];
const TENANT_DATA_RE = new RegExp(`\\b(${NAMES.join("|")})\\b`, "i");
const MAX_REPORTS = 500;
const reported = new Set();

function callSite() {
  const frames = String(new Error().stack || "")
    .split("\n")
    .slice(1)
    .map((l) => l.trim())
    .filter((l) => l && !/tenancy-audit\.js|postgres[\\/]client\.js|node:internal|node_modules/.test(l));
  return frames.slice(0, 3).join(" <- ") || "(unknown)";
}

/** Returns the finding it logged, or null - returned for tests. */
export function auditTenantlessQuery(sql) {
  if (getEnv().postgres?.tenancyAudit !== true) return null;
  if (currentTenantId()) return null;
  const match = TENANT_DATA_RE.exec(String(sql ?? ""));
  if (!match) return null;
  if (reported.size >= MAX_REPORTS) return null;
  const site = callSite();
  const key = `${match[1].toLowerCase()}|${site}`;
  if (reported.has(key)) return null;
  reported.add(key);
  const finding = { table: match[1].toLowerCase(), site };
  console.warn(`[tenancy-audit] "${finding.table}" queried with no tenant published at ${site}`);
  return finding;
}

export function __resetTenancyAuditForTests() {
  reported.clear();
}
