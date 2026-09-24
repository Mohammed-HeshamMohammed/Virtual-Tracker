/**
 * The single source of truth for which Postgres tables carry tenant
 * isolation, and which are deliberately global. See
 * PLAN-customer-accounts-and-tenancy.md §15.5 for the full reasoning behind
 * each entry.
 *
 * This list is consumed by THREE separate places that must never drift
 * apart from each other:
 *   1. ensure-lookup-schema.js  - adds `tenant_id` to every scoped table
 *   2. ensure-tenancy-rls.js    - generates the RLS policy for every scoped
 *                                 table (Phase 3)
 *   3. test/tenancy-rls-coverage.test.js - fails if a table exists in the
 *                                          database but not in this list
 *
 * A table that is missing from both TENANT_SCOPED_TABLES and GLOBAL_TABLES
 * gets no `tenant_id` column, no RLS policy, and fails the coverage test -
 * loud, not silent. That is the point: a table can be forgotten, but it
 * cannot be forgotten *quietly*.
 *
 * Tables with high row volume are marked `highVolume: true` so the Phase 2
 * backfill script can batch them and build their indexes CONCURRENTLY
 * rather than locking them for a single-pass UPDATE.
 */

export const TENANT_SCOPED_TABLES = [
  // Identity & tree
  "members",
  "member_relationships",
  "member_tree_cache",
  "member_transfer_requests",
  "member_bans",
  "member_onboarding",
  "members_field_data",
  "pending_auth_members",
  "invites",
  "invite_projects",
  "pending_auth_projects",
  "access_requests",
  "deactivation_requests",
  "org_field_options",
  "lookup_tables",

  // Employment & pay
  "employment",
  "pay_rates",
  "pay_rate_history",
  "limits",
  "time_settings",
  "member_makeup_days",
  "currency_settings",

  // Work
  "projects",
  "project_members",
  "project_budgets",
  "project_budget_notify_state",
  "project_member_limits",
  "project_subprojects",
  "teams",
  "team_members",
  "team_projects",
  "clients",
  "client_budgets",
  "client_invoicing",
  "client_projects",
  "client_automation_state",

  // Tasks
  "tasks",
  "task_assignments",
  "task_comments",
  "task_subtasks",
  "task_attachments",
  "task_hours",
  "task_member_progress",

  // Time
  { name: "time_entries", highVolume: true },
  "timesheets",
  { name: "daily_member_active_seconds", highVolume: true },
  { name: "daily_member_task_active_seconds", highVolume: true },
  "time_off_policies",
  "time_off_requests",
  "time_off_transactions",

  // Activity & monitoring
  { name: "activity_sessions", highVolume: true },
  { name: "activity_session_events", highVolume: true },
  { name: "activity_screenshots", highVolume: true },
  { name: "activity_app_logs", highVolume: true },
  { name: "activity_url_logs", highVolume: true },
  "activity_integrity_flags",
  "activity_alert_log",
  "activity_categories",
  "activity_scoring_settings",
  "screenshot_access_log",
  "capture_exclusions",
  "capture_minimization_settings",
  "data_retention_settings",
  "monitoring_capabilities",
  "monitoring_policy_audit",
  "member_monitoring_consent",

  // Agent
  "agent_devices",
  "agent_link_sessions",
  "agent_notifications",
  // Owner<->member conversations. Scoped for the obvious reason: a thread
  // must never be readable from another organization.
  "screenshot_removal_requests",
  "message_threads",
  "thread_messages",

  // Money
  "invoices",
  "invoice_line_items",
  "invoice_payments",
  "expenses",

  // Reporting & comms
  "saved_reports",
  "report_schedules",
  "notifications",

  // Cross-cutting: populated generically by fn_audit_log_trigger() from
  // whichever row triggered it going forward (see §14.3) - existing rows are
  // still backfilled to the main tenant like every other table below.
  { name: "audit_logs", highVolume: true },
];

/**
 * Tables that intentionally do NOT get a tenant_id. Each reason is the
 * justification for a deliberate hole in the isolation and must be able to
 * stand on its own if someone questions it later.
 */
export const GLOBAL_TABLES = [
  { name: "roles", reason: "The 9-role catalog is the platform's own ladder; customers use it, they do not define it." },
  { name: "role_permissions", reason: "Permissions attached to the global role catalog above." },
  { name: "apps", reason: "A name→icon dictionary of known applications, not an observation of who ran what (that is activity_app_logs, which is scoped)." },
  { name: "currency_rates", reason: "FX reference data, identical for every tenant." },
  { name: "system_meta", reason: "Bootstrap and migration markers for the process, not tenant data." },
  { name: "device_bans", reason: "assertDeviceNotBanned runs before authentication, before any tenant is known - a device ban is platform-wide by necessity." },
];

/** Tables physically unable to hold more than one row today (§15.3) - a
 *  tenant_id column is not sufficient for these; their primary key changes
 *  in the same migration that adds the column. Also tenant-scoped, also in
 *  TENANT_SCOPED_TABLES above; listed again here so the PK migration and the
 *  RLS policy generator both know to treat them specially. */
export const SINGLETON_KEY_TABLES = [
  { name: "currency_settings", oldKey: "id", note: "was id SMALLINT PK CHECK (id = 1)" },
  { name: "capture_minimization_settings", oldKey: "id", note: "was id SMALLINT PK CHECK (id = 1)" },
  { name: "activity_scoring_settings", oldKey: "id", note: "was id SMALLINT PK CHECK (id = 1)" },
  { name: "data_retention_settings", oldKey: "data_type", note: "was data_type PK, 4 fixed rows" },
  { name: "monitoring_capabilities", oldKey: "capability", note: "was capability PK, 6 fixed rows" },
];

/** UNIQUE constraints keyed on a human-chosen string rather than a UUID,
 *  which break once two tenants can both want the same name (§15.4). */
export const UNIQUE_CONSTRAINTS_NEEDING_TENANT = [
  { table: "lookup_tables", oldConstraint: "uq_lookup_category_name", columns: ["category", "name"] },
  { table: "org_field_options", oldConstraint: "uq_org_field_type_label", columns: ["type", "label"] },
  { table: "invoices", oldConstraint: null, columns: ["number"], note: "UNIQUE (number), unnamed constraint" },
  { table: "time_off_policies", oldConstraint: null, columns: ["name"], note: "UNIQUE (name), unnamed constraint" },
];

function tableName(entry) {
  return typeof entry === "string" ? entry : entry.name;
}

export function listTenantScopedTableNames() {
  return TENANT_SCOPED_TABLES.map(tableName);
}

export function listHighVolumeTableNames() {
  return TENANT_SCOPED_TABLES.filter((e) => typeof e === "object" && e.highVolume).map((e) => e.name);
}

export function listGlobalTableNames() {
  return GLOBAL_TABLES.map((e) => e.name);
}
