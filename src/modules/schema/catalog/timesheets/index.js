/**
 * Timesheets domain — served via generic schema CRUD at /api/time-entries and /api/timesheets.
 */
export const timesheetSchemas = [
  {
    key: "time-entries",
    collection: "time_entries",
    description: "Logged work time rows for timesheet view",
    fields: {
      id: "uuid",
      member_id: "uuid",
      project_id: "uuid",
      task_id: "uuid",
      date: "string",
      start_time: "string",
      end_time: "string",
      duration: "int",
      description: "text",
      billable: "boolean",
      status: "string",
      created_at: "timestamp",
      updated_at: "timestamp",
      created_by: "uuid",
      updated_by: "uuid",
    },
  },
  {
    key: "timesheets",
    collection: "timesheets",
    description: "Pay-period timesheet submissions",
    fields: {
      id: "uuid",
      member_id: "uuid",
      period_start: "string",
      period_end: "string",
      status: "string",
      total_hours: "number",
      billable_hours: "number",
      submitted_at: "timestamp",
      approved_at: "timestamp",
      approved_by: "uuid",
      created_at: "timestamp",
      updated_at: "timestamp",
    },
  },
]
