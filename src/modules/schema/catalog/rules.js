export const schemaRulesByKey = {
  members: {
    requiredOnCreate: ["first_name", "last_name", "work_email", "status"],
    validators: [
      { field: "work_email", validate: (v) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v), message: "work_email must be a valid email" },
      { field: "status", validate: (v) => ["active", "inactive", "paused"].includes(v), message: "status must be active|inactive|paused" },
    ],
  },
  invites: {
    requiredOnCreate: ["email", "role_id", "status"],
    validators: [
      { field: "email", validate: (v) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v), message: "email must be a valid email" },
      { field: "status", validate: (v) => ["pending", "accepted", "revoked"].includes(v.toLowerCase()), message: "status must be pending|accepted|revoked" },
    ],
  },
  tasks: {
    requiredOnCreate: ["project_id", "title", "status"],
    validators: [
      { field: "status", validate: (v) => ["todo", "in_progress", "in_review", "blocked", "done"].includes(v), message: "status must be todo|in_progress|in_review|blocked|done" },
      { field: "priority", validate: (v) => !v || ["low", "medium", "high", "urgent"].includes(v), message: "priority must be low|medium|high|urgent" },
      { field: "order_index", validate: (v) => v === undefined || (Number.isInteger(v) && v >= 0), message: "order_index must be a non-negative integer" },
      { field: "review_state", validate: (v) => !v || ["approved", "rejected"].includes(v), message: "review_state must be approved|rejected" },
    ],
  },
  "task-assignments": {
    requiredOnCreate: ["task_id", "member_id", "status"],
    validators: [
      {
        field: "status",
        validate: (v) => ["todo", "in_progress", "in_review", "blocked", "done"].includes(v),
        message: "status must be todo|in_progress|in_review|blocked|done",
      },
      {
        field: "review_state",
        validate: (v) => !v || ["approved", "rejected"].includes(v),
        message: "review_state must be approved|rejected",
      },
    ],
  },
  "task-subtasks": {
    requiredOnCreate: ["task_id", "title"],
    validators: [
      { field: "completed", validate: (v) => v === undefined || typeof v === "boolean", message: "completed must be a boolean" },
      { field: "order_index", validate: (v) => v === undefined || (Number.isInteger(v) && v >= 0), message: "order_index must be a non-negative integer" },
    ],
  },
  projects: {
    requiredOnCreate: ["name", "status"],
    validators: [
      {
        field: "status",
        validate: (v) => ["active", "archived", "completed"].includes(String(v).toLowerCase()),
        message: "status must be active|archived|completed",
      },
    ],
  },
  clients: {
    requiredOnCreate: ["name"],
    validators: [
      {
        field: "status",
        validate: (v) => !v || ["active", "archived"].includes(String(v).toLowerCase()),
        message: "status must be active|archived",
      },
    ],
  },
  "project-members": { requiredOnCreate: ["project_id", "member_id", "project_role"] },
  "client-budgets": {
    validators: [
      {
        field: "type",
        validate: (v) => !v || ["hourly", "fixed", "retainer", "none"].includes(String(v).toLowerCase()),
        message: "type must be hourly|fixed|retainer|none",
      },
      {
        field: "based_on",
        validate: (v) => !v || ["per_person", "per_project", "total"].includes(String(v).toLowerCase()),
        message: "based_on must be per_person|per_project|total",
      },
      {
        field: "resets",
        validate: (v) => !v || ["monthly", "quarterly", "yearly", "never"].includes(String(v).toLowerCase()),
        message: "resets must be monthly|quarterly|yearly|never",
      },
      { field: "notify_at_pct", validate: (v) => v >= 0 && v <= 100, message: "notify_at_pct must be between 0 and 100" },
      { field: "cost", validate: (v) => v === undefined || v >= 0, message: "cost must be >= 0" },
    ],
  },
  "client-invoicing": {
    validators: [
      {
        field: "tax_rate",
        validate: (v) => v === undefined || (v >= 0 && v <= 100),
        message: "tax_rate must be between 0 and 100",
      },
      {
        field: "net_terms_days",
        validate: (v) => v === undefined || (Number.isInteger(v) && v >= 0),
        message: "net_terms_days must be a non-negative integer",
      },
      {
        field: "auto_invoice_amount_based_on",
        validate: (v) => !v || ["hourly", "fixed"].includes(String(v).toLowerCase()),
        message: "auto_invoice_amount_based_on must be hourly|fixed",
      },
      {
        field: "auto_invoice_frequency",
        validate: (v) => !v || ["weekly", "biweekly", "monthly"].includes(String(v).toLowerCase()),
        message: "auto_invoice_frequency must be weekly|biweekly|monthly",
      },
      {
        field: "auto_invoice_line_items",
        validate: (v) =>
          !v ||
          [
            "detailed_project_user_date",
            "detailed_project_date",
            "detailed_project_user",
            "detailed_todo_user_date",
            "detailed_todo_date",
            "detailed_todo_user",
            "summary_user_date",
            "summary_user",
            "summary_project",
            "summary_todo",
            "summary_date",
          ].includes(String(v)),
        message: "auto_invoice_line_items is invalid",
      },
    ],
  },
  "project-budgets": {
    validators: [
      { field: "notify_at_pct", validate: (v) => v >= 0 && v <= 100, message: "notify_at_pct must be between 0 and 100" },
      { field: "stop_timers_at_pct", validate: (v) => v >= 0 && v <= 100, message: "stop_timers_at_pct must be between 0 and 100" },
    ],
  },
};
