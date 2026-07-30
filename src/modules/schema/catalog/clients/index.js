// "clients", "client-budgets", and "client-invoicing" were removed from this
// array in Phase 9 of the Clients migration (see project-budget-fixes-plan.md).
// All three domains are Postgres-resident now (clients-postgres.service.js)
// with their own dedicated routes in clients/routes.js - the generic
// Firestore-catalog path in schema/routes.js (gated on `schemaByKey.get(key)`
// being truthy) is unreachable for them by design, not an oversight.
//
// "client-projects" is left in place: it already routes through the
// Postgres-resident client_projects table via projects/routes.js and
// schema/routes.js's own special-cased branches - untouched here since
// nothing about it was Firestore-backed to begin with.
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
