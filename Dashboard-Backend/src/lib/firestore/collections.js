// Firestore collections still in use. Profile extensions (employment, limits, …) are in Postgres — member-data-store.js.
export const COLLECTIONS = Object.freeze({
  members: "members",
  memberAuthIndex: "member_auth_index",
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

/** Invalid under members/{memberId} — includes tables we moved to Postgres. */
export const INVALID_MEMBER_SUBCOLLECTIONS = Object.freeze([
  "employment",
  "pay_rates",
  "time_settings",
  "limits",
  "member_onboarding",
  "member_relationships",
  "member_tree_cache",
  "members",
  "system_meta",
  "member_bans",
  "device_bans",
]);

/**
 * @param {import("firebase-admin/firestore").Firestore} db
 * @param {keyof typeof COLLECTIONS} key
 */
export function topCollection(db, key) {
  return db.collection(COLLECTIONS[key]);
}
