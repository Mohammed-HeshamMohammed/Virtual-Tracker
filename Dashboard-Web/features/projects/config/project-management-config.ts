/** Overview, Projects, Tasks, Clients, Time off requests */
export const PROJECT_MANAGEMENT_IMPORT_EXPORT_ENABLED = false

export const PROJECT_MEMBER_LIMITS_ENABLED = true

export const PROJECT_MEMBER_LIMITS_COMING_SOON_MESSAGE =
  "Member limits are coming soon. Use project budget settings for now."

export const PROJECT_BATCH_ACTIONS = [  "Archive selected",
  "Delete selected",
  ...(PROJECT_MANAGEMENT_IMPORT_EXPORT_ENABLED ? (["Export selected"] as const) : []),
  "Set member limit",
] as const
