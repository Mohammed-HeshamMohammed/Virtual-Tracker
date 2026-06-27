import { COLLECTIONS } from "../../../../lib/firestore/collections.js";

export const notificationSchemas = [
  {
    key: "notifications",
    collection: COLLECTIONS.notifications,
    fields: {
      id: "uuid",
      recipient_id: "uuid",
      type: "string",
      title: "string",
      message: "string",
      link: "string",
      read: "boolean",
      created_at: "timestamp",
    },
    defaultOrderBy: "created_at",
  },
];
