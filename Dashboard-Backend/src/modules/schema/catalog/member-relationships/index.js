
export const memberRelationshipSchemas = [
  {
    key: "member-relationships",
    collection: "member_relationships",
    description: "Tracks parent-child relationships between members (who added whom)",
    fields: {
      id: "uuid",
      parent_member_id: "uuid", // The member who did the adding (creator/inviter)
      child_member_id: "uuid", // The member who was added (invitee)
      relationship_type: "string", // "invite", "preprovision", "self_signup", "admin_create"
      projects: "array", // Project IDs shared between parent and child (for visibility)
      created_at: "timestamp",
      created_by: "uuid", // Who recorded this relationship (usually same as parent)
    },
    indexes: [
      { fields: ["parent_member_id", "created_at"] },
      { fields: ["child_member_id"] },
      { fields: ["parent_member_id", "child_member_id"], unique: true },
      { fields: ["projects", "array_contains"] },
    ],
    defaultOrderBy: "created_at",
  },
  {
    key: "member-tree-cache",
    collection: "member_tree_cache",
    description: "Cached computed tree data for fast reads",
    fields: {
      id: "uuid", // member_id
      ancestors: "array", // Array of { member_id, level, relationship_type }
      descendants: "array", // Array of { member_id, level, relationship_type }
      root_id: "uuid", // The top-most ancestor
      depth: "number", // How deep in the tree (0 = root)
      updated_at: "timestamp",
    },
  },
];
