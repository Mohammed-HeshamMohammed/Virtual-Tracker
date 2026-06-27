/**
 * Canonical top-level Firestore collection names.
 * Never write these as subcollections under members/{id}/… — use only db.collection(NAME).
 */
export const COLLECTIONS = Object.freeze({
  members: "members",
  memberAuthIndex: "member_auth_index",
  memberOnboarding: "member_onboarding",
  memberRelationships: "member_relationships",
  memberTreeCache: "member_tree_cache",
  memberTransferRequests: "member_transfer_requests",
  employment: "employment",
  payRates: "pay_rates",
  timeSettings: "time_settings",
  limits: "limits",
  roles: "roles",
  systemMeta: "system_meta",
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

/** Subcollections that must NOT exist under members/{memberId}. */
export const INVALID_MEMBER_SUBCOLLECTIONS = Object.freeze([
  COLLECTIONS.employment,
  COLLECTIONS.payRates,
  COLLECTIONS.timeSettings,
  COLLECTIONS.limits,
  COLLECTIONS.memberOnboarding,
  COLLECTIONS.memberRelationships,
  COLLECTIONS.memberTreeCache,
  COLLECTIONS.members,
  COLLECTIONS.systemMeta,
]);

/**
 * @param {import("firebase-admin/firestore").Firestore} db
 * @param {keyof typeof COLLECTIONS} key
 */
export function topCollection(db, key) {
  return db.collection(COLLECTIONS[key]);
}
