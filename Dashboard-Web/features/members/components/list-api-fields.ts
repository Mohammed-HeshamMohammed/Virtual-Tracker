/** Lean field list for People members table — avoids full member profile reads. */
export const MEMBERS_LIST_API_FIELDS = [
  "id",
  "first_name",
  "last_name",
  "work_email",
  "personal_email",
  "role",
  "role_name",
  "avatar",
  "avatar_color",
  "avatar_url",
  "firebase_uid",
  "tracking_status",
  "date_added",
  "teams",
  "projects",
  "payment",
  "limits",
  "phone",
  "created_by",
  "created_by_uid",
  "hierarchy_status",
  "status",
  "privileges",
  "ip_address",
] as const

/** Lean field list for pending invites table. */
export const INVITES_LIST_API_FIELDS = [
  "id",
  "email",
  "role",
  "role_name",
  "status",
  "invite_kind",
  "pay_rate",
  "project_ids",
  "sent_at",
  "created_by",
] as const

/** Teams list + enrichment — roster display comes from enriched team-members API. */
export const TEAMS_LIST_API_FIELDS = ["id", "name", "schedule_weekly_report"] as const

export const TEAM_MEMBERS_LIST_API_FIELDS = [
  "id",
  "team_id",
  "member_id",
  "is_lead",
  "member_name",
  "member_avatar",
  "member_color",
  "member_role",
] as const

export const TEAM_PROJECTS_LIST_API_FIELDS = ["id", "team_id", "project_id", "project_name"] as const

export const PROJECTS_NAME_LIST_API_FIELDS = ["id", "name"] as const
