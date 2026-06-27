export const teamSchemas = [
  {
    key: "teams",
    collection: "teams",
    fields: {
      id: "uuid",
      name: "string",
      schedule_weekly_report: "boolean",
      last_weekly_report_sent_at: "timestamp",
      created_at: "timestamp",
      created_by: "uuid",
      updated_by: "uuid",
    },
  },
  {
    key: "team-members",
    collection: "team_members",
    fields: {
      id: "uuid",
      team_id: "uuid",
      member_id: "uuid",
      is_lead: "boolean",
      joined_at: "timestamp",
      assigned_by: "uuid",
      updated_by: "uuid",
    },
  },
  {
    key: "team-projects",
    collection: "team_projects",
    fields: {
      id: "uuid",
      team_id: "uuid",
      project_id: "uuid",
      assigned_at: "timestamp",
      assigned_by: "uuid",
    },
  },
];
