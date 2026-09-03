export const clientSchemas = [
  {
    key: "client-projects",
    collection: "client_projects",
    fields: {
      id: "uuid",
      client_id: "uuid",
      project_id: "uuid",
      assigned_by: "uuid",
      assigned_at: "timestamp",
    },
  },
];
