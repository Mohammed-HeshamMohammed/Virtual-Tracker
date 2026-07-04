import { COLLECTIONS } from "../lib/firestore/collections.js";

// Entity registry — see docs/entity-diagram.md. policy = when auto-bootstrap runs.

/** @typedef {"org_seed" | "org_marker" | "member_ensure" | "auth_flow" | "runtime" | "on_demand"} BootstrapPolicy */

/** @type {Array<{ collection: string, entityKey?: string, policy: BootstrapPolicy, notes?: string }>} */
export const ENTITY_BOOTSTRAP_MANIFEST = [
  // --- Auth & profiles ---
  { collection: "User_profiles", policy: "auth_flow", notes: "Upserted on session-bootstrap; avatars stored in GCS (photoURL)" },
  { collection: "members", policy: "auth_flow", notes: "ensureMemberRowForUserRecord on verify" },
  { collection: "pending_auth_members", policy: "auth_flow", notes: "Admin pre-provision only" },
  { collection: "pending_auth_projects", policy: "auth_flow", notes: "With pending_auth_members" },
  { collection: "access_requests", policy: "on_demand", notes: "Public access-request form" },

  // --- Members domain (org + per-member) ---
  { collection: "roles", entityKey: "roles", policy: "org_seed", notes: "Default Owner to Viewer (9 roles)" },
  { collection: "member_auth_index", policy: "auth_flow", notes: "firebase_uid → members.id (prevents duplicate members)" },
  { collection: "member_onboarding", entityKey: "member-onboarding", policy: "member_ensure" },
  { collection: "invites", entityKey: "invites", policy: "on_demand" },
  { collection: "invite_projects", entityKey: "invite-projects", policy: "on_demand" },
  { collection: "members_field_data", policy: "org_seed", notes: "Org dropdown options + per-member snapshots on save" },

  // --- Employment lookups (org) + member rows ---
  { collection: "job_titles", entityKey: "job-titles", policy: "org_seed" },
  { collection: "departments", entityKey: "departments", policy: "org_seed" },
  { collection: "job_types", entityKey: "job-types", policy: "org_seed" },
  { collection: "tax_types", entityKey: "tax-types", policy: "org_seed" },
  { collection: "employment", entityKey: "employment", policy: "member_ensure" },
  { collection: "pay_rates", entityKey: "pay-rates", policy: "member_ensure" },
  { collection: "time_settings", entityKey: "time-settings", policy: "member_ensure" },
  { collection: "limits", entityKey: "limits", policy: "member_ensure" },

  // --- Relationships ---
  { collection: "member_relationships", entityKey: "member-relationships", policy: "org_seed", notes: "initializeMemberRelationships when empty" },
  { collection: "member_tree_cache", entityKey: "member-tree-cache", policy: "member_ensure" },
  { collection: "member_tree", policy: "on_demand", notes: "Legacy; migration only" },

  // --- Clients (created via Clients UI) ---
  { collection: "clients", entityKey: "clients", policy: "on_demand" },
  { collection: "client_budgets", entityKey: "client-budgets", policy: "on_demand" },
  { collection: "client_invoicing", entityKey: "client-invoicing", policy: "on_demand" },
  { collection: "client_projects", entityKey: "client-projects", policy: "on_demand" },

  // --- Projects & teams ---
  { collection: COLLECTIONS.projects, entityKey: "projects", policy: "on_demand" },
  { collection: "project_members", entityKey: "project-members", policy: "on_demand" },
  { collection: "project_budgets", entityKey: "project-budgets", policy: "on_demand" },
  { collection: "project_member_limits", entityKey: "project-member-limits", policy: "on_demand" },
  { collection: "teams", entityKey: "teams", policy: "on_demand" },
  { collection: "team_members", entityKey: "team-members", policy: "on_demand" },
  { collection: "team_projects", entityKey: "team-projects", policy: "on_demand" },

  // --- Tasks (child entities live under tasks/{taskId}/ subcollections) ---
  { collection: "tasks", entityKey: "tasks", policy: "on_demand" },
  { collection: "tasks/*/comments", entityKey: "task-comments", policy: "on_demand" },
  { collection: "tasks/*/subtasks", entityKey: "task-subtasks", policy: "on_demand" },
  { collection: "tasks/*/attachments", entityKey: "task-attachments", policy: "on_demand" },
  { collection: "task_assignments", entityKey: "task-assignments", policy: "on_demand" },
  { collection: "tasks/*/hours", entityKey: "task-hours", policy: "on_demand" },
  { collection: "tasks/*/time_tracking", entityKey: "task-time-tracking", policy: "runtime", notes: "Active timer state per user/task" },

  // --- Activity (runtime only; no login bootstrap) ---
  { collection: "activity_sessions", entityKey: "activity-sessions", policy: "runtime" },
  { collection: "activity_screenshots", entityKey: "activity-screenshots", policy: "runtime" },
  { collection: "activity_app_logs", entityKey: "activity-app-logs", policy: "runtime" },
  { collection: "activity_url_logs", entityKey: "activity-url-logs", policy: "runtime" },

  // --- System ---
  { collection: "system_meta", policy: "org_marker", notes: "entity_bootstrap + member_document_ids markers" },
];

export const ORG_LOOKUP_SEEDS = {
  job_titles: ["Intern / Entry level", "Junior", "Intermediate", "Senior", "Lead / Principal"],
  departments: ["Support / ancillary", "Operations", "Engineering", "Product", "Executive / leadership"],
  job_types: ["Full-time", "Part-time", "Contractor", "Intern"],
  tax_types: ["W-2", "1099", "Exempt"],
};

/** Stored in `members_field_data` (organization-field-options API). */
export const ORG_FIELD_OPTION_SEEDS = {
  jobTitle: ["Intern / Entry level", "Junior", "Intermediate", "Senior", "Lead / Principal"],
  department: ["Support / ancillary", "Operations", "Engineering", "Product", "Executive / leadership"],
  jobType: ["Full-time", "Part-time", "Contractor", "Intern"],
  taxType: ["W-2", "1099", "Exempt"],
  employmentType: [
    "Contractor - hourly",
    "Contractor - fixed rate",
    "Contractor - project based",
    "FTE - hourly (full-time employee)",
    "FTE - salary (full-time employee)",
  ],
  employedThrough: ["Direct - hired by us", "Vendor", "EOR", "Subsidiary"],
  workplaceModel: ["In-office", "Remote", "Hybrid"],
  terminationReason: ["Voluntary", "Involuntary", "Contract ended"],
};

export const ENTITY_BOOTSTRAP_META_DOC = "system_meta/entity_bootstrap";
export const ENTITY_BOOTSTRAP_VERSION = 1;
