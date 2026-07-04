/**
 * Canonical top-level Firestore collection names still stored in Firestore.
 * Member profile extensions (employment, limits, time_settings, bans, tree cache, system_meta)
 * live in PostgreSQL — see src/lib/postgres/member-data-store.js.
 */
export const COLLECTIONS = Object.freeze({
  members: "members",
  memberAuthIndex: "member_auth_index",
  memberOnboarding: "member_onboarding",
  memberRelationships: "member_relationships",
  memberTransferRequests: "member_transfer_requests",
  payRates: "pay_rates",
  roles: "roles",
  membersFieldData: "members_field_data",
  jobTitles: "job_titles",
  departments: "departments",
  jobTypes: "job_types",
  taxTypes: "tax_types",
  projects: "projects_VirtualTacker",
  notifications: "notifications_VirtualTacker",
});

/** Legacy mobile-app Firestore collections — do not read or write from Virtual Tracker backend code. */
export const MOBILE_APP_COLLECTIONS = Object.freeze([
  "users",
  "referrals",
  "notifications",
  "chatRooms",
  "candidates",
  "projects",
]);

/** Subcollections that must NOT exist under members/{memberId} (includes retired Firestore top-level names). */
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
