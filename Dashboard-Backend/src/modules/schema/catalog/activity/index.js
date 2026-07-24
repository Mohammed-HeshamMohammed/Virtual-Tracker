export const activitySchemas = [
  {
    key: "activity-sessions",
    collection: "activity_sessions",
    fields: {
      id: "uuid",
      member_id: "uuid",
      status: "string",
      started_at: "timestamp",
      ended_at: "timestamp",
      active_seconds: "int",
      idle_seconds: "int",
      task_id: "uuid",
      updated_at: "timestamp",
    },
  },
  {
    key: "activity-alert-log",
    collection: "activity_alert_log",
    fields: {
      id: "uuid",
      subject_member_id: "uuid",
      alert_type: "string",
      recipient_ids: "array",
      sent_at: "timestamp",
    },
  },
];
