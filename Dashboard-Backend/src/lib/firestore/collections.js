// Firestore collection names. Only User_profiles still stores anything -
// everything else here is either a name the mobile-app lint script matches
// against, or the legacy projects name kept for the bootstrap manifest.
export const COLLECTIONS = Object.freeze({
  members: "members",
  memberRelationships: "member_relationships",
  memberTransferRequests: "member_transfer_requests",
  roles: "roles",
  membersFieldData: "members_field_data",
  jobTitles: "job_titles",
  departments: "departments",
  jobTypes: "job_types",
  taxTypes: "tax_types",
  projects: "projects_VirtualTacker",
});

/** Old mobile-app collections — don't touch from this backend. */
export const MOBILE_APP_COLLECTIONS = Object.freeze([
  "users",
  "referrals",
  "notifications",
  "chatRooms",
  "candidates",
  "projects",
]);
