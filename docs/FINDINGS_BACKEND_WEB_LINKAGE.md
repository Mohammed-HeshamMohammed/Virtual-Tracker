# Audit & Findings — Backend-Web Linkage & Pure SQL Cutover Restoration

## Executive Summary

To fulfill the explicit directive that the application must run **directly and exclusively on PostgreSQL** without relying on empty or cleared Firestore collections, a comprehensive codebase audit was conducted across `Dashboard-Backend` and `Dashboard-Web`.

Every backend service module, helper function, authorization guard, member management routine, activity feeder, hierarchy manager, and client service that previously read or wrote to legacy Firestore collections (`members`, `teams`, `team_members`, `project_members`, `member_relationships`, `member_tree`, `member_transfer_requests`, `member_bans`, etc.) has been refactored to execute direct PostgreSQL SQL queries against the active PostgreSQL database.

---

## Direct PostgreSQL Conversions Applied (Phase 1 & Phase 2)

### 1. Member Profile & Editing (`Dashboard-Backend/src/modules/members/services/member-profile.service.js`)
- **Previous Firestore Dependency**: Executed `db.collection("members").doc(memberId).get()` and `.update()`. Caused `"Member not found"` 404/500 errors when opening or saving member profiles in `Dashboard-Web`.
- **Pure SQL Fix**:
  - Replaced profile fetching with `getMemberByIdPg(memberId)`.
  - Replaced profile updates with `updateMemberPg(memberId, memberUpdates)`.
  - Added support for PostgreSQL transaction/optimistic lock checks on `info_updated_at` and `roles_updated_at`.

### 2. Member Roles & Relationship Sync (`Dashboard-Backend/src/modules/members/services/relation-sync.js`)
- **Previous Firestore Dependency**:
  - `syncMemberPrimaryRole`: Attempted `db.collection("members").doc(memberId).set()`.
  - `alignMemberRoleTables`: Attempted `db.collection("members").doc(memberId).get()`.
  - `cascadeDeleteMemberRelations`: Executed Firestore batch delete on `team_members`.
  - `fetchMemberProfilesAndRoleNamesInChunks`: Batch-fetched Firestore `members` docs in chunks of 30.
- **Pure SQL Fix**:
  - Replaced role writes with `updateMemberPg(memberId, { role_id, deactivation_governance, ... })`.
  - Replaced role alignment reads with `getMemberByIdPg`.
  - Replaced cascade deletion with `DELETE FROM team_members WHERE member_id = $1` and `DELETE FROM project_members WHERE member_id = $1`.
  - Replaced profile chunk fetches with `getMembersByIdsPg(memberIds)`.

### 3. Tree Removal Service (`Dashboard-Backend/src/modules/members/services/member-remove-from-tree-service.js`)
- **Previous Firestore Dependency**: `db.collection("members").doc(memberId).get()`, `db.collection("team_members")`, `db.collection("project_members")`, `db.collection("members").doc(memberId).set()`.
- **Pure SQL Fix**:
  - Replaced member check with `getMemberByIdPg`.
  - Replaced team & project link removals with PostgreSQL `DELETE FROM team_members WHERE member_id = $1` and `DELETE FROM project_members WHERE member_id = $1`.
  - Replaced status update with `updateMemberPg(memberId, { hierarchy_status: 'unassigned', ... })`.

### 4. Member Ban & Revocation Service (`Dashboard-Backend/src/modules/members/services/member-ban-service.js`)
- **Previous Firestore Dependency**: `db.collection("members").doc(memberId).get()` and `.set({ status: 'banned' | 'active' })`.
- **Pure SQL Fix**:
  - Replaced member check with `getMemberByIdPg`.
  - Replaced ban and unban updates with `updateMemberPg(memberId, { status: 'banned' | 'active' })`.

### 5. Hierarchy Transfer Requests (`Dashboard-Backend/src/modules/hierarchy/transfer-request.service.js`)
- **Previous Firestore Dependency**:
  - `findMemberByEmail`: `db.collection("members").where("work_email", "==", normalized)` and `personal_email`.
  - `getRequesterDisplayName`: `db.collection("members").doc(requesterMemberId).get()`.
  - `notifyAdminRoles`: `db.collection("members").where("role_id", "in", roleIds)`.
- **Pure SQL Fix**:
  - Replaced email lookup with `SELECT * FROM members WHERE LOWER(work_email) = $1 OR LOWER(personal_email) = $1 LIMIT 1`.
  - Replaced requester lookup with `getMemberByIdPg`.
  - Replaced admin role notification target query with `SELECT id FROM members WHERE role_id = ANY($1) AND status != 'banned'`.

### 6. Member Relationships & Visibility (`Dashboard-Backend/src/modules/member-relationships/service.js`)
- **Previous Firestore Dependency**:
  - `getMembersBySharedProjects`: `db.collection("members").doc(memberId)` and `db.collection("members").where("projects", "array-contains", projectId)`.
  - `memberBelongsToOrg`, `collectOrgAdminCreators`, `getOrgUplineAddedMemberIds`, `getTeamSubtreeMemberIds`: Multiple `db.collection("members")` doc and query checks.
- **Pure SQL Fix**:
  - `getMembersBySharedProjects`: Executed `SELECT DISTINCT member_id FROM project_members WHERE project_id IN (SELECT project_id FROM project_members WHERE member_id = $1) AND member_id != $1`.
  - `memberBelongsToOrg` & `collectOrgAdminCreators`: Converted to `getMemberByIdPg`.
  - `getOrgUplineAddedMemberIds` & `getTeamSubtreeMemberIds`: Converted to PostgreSQL queries `SELECT id FROM members WHERE created_by_uid = $1` and `SELECT id FROM members WHERE created_by = $1`.

### 7. First-Login Notifications (`Dashboard-Backend/src/modules/notifications/first-login-notify.js`)
- **Previous Firestore Dependency**: `db.collection("members").where("firebase_uid", "==", createdByUid)` and `db.collection("members").doc(memberId).update(...)`.
- **Pure SQL Fix**: Replaced with `SELECT id FROM members WHERE firebase_uid = $1 LIMIT 1` and `updateMemberPg(memberId, { first_login_notified_at })`.

### 8. Activity Scope & Role Resolution (`Dashboard-Backend/src/modules/activity/activity-scope.js`)
- **Previous Firestore Dependency**: `resolveMemberRoleName` called `db.collection("members").doc(memberId).get()`. Caused all role checks across activity feeds to fall back to `"Viewer"`. `buildMemberMetaMap` chunk-fetched Firestore `members` docs.
- **Pure SQL Fix**: Replaced with `getMemberByIdPg(memberId)` and `getMembersByIdsPg(allowedIds)`.

### 9. Project Access Control (`Dashboard-Backend/src/http/project-access.js`)
- **Previous Firestore Dependency**: `getViewerProjectIds` checked `db.collection("members").doc(viewerMemberId)` for legacy projects array.
- **Pure SQL Fix**: Streamlined to return `await listProjectIdsForMemberPg(viewerMemberId)` directly.

### 10. Role Assignment Guard (`Dashboard-Backend/src/http/role-assignment-guard.js`)
- **Previous Firestore Dependency**: `validateMemberRoleChange` called `db.collection("members").doc(memberId).get()`.
- **Pure SQL Fix**: Replaced with `getMemberByIdPg(memberId)`.

### 11. Profile Settings & User Sync (`Dashboard-Backend/src/modules/auth/profile-settings.js`)
- **Previous Firestore Dependency**: `syncMemberEmailForUid`, `syncMemberNamesForUid`, `syncMemberPhoneForUid`, `syncMemberTimezoneForUid`, and `reconcileMemberNamesFromProfile` queried `db.collection("members").where("firebase_uid", "==", uid)` and updated Firestore.
- **Pure SQL Fix**: Converted to execute direct PostgreSQL `UPDATE members SET ... WHERE firebase_uid = $1` queries and `updateMemberPg`.

### 12. Client Management Service (`Dashboard-Backend/src/modules/clients/services/client-service.js`)
- **Previous Firestore Dependency**: `assertMemberExists` checked `db.collection("members").doc(memberId).get()`.
- **Pure SQL Fix**: Replaced with `getMemberByIdPg(memberId)`.

### 13. Dashboard Utilities & Presence (`Dashboard-Backend/src/modules/dashboard/`)
- **Previous Firestore Dependency**: `dashboard-utils.js` (`getMemberProjectIds`) and `general-dashboard-service.js` (`buildPresenceByMember`) called `db.collection("members")`.
- **Pure SQL Fix**:
  - `getMemberProjectIds`: Returns `new Set(await listProjectIdsForMemberPg(memberId))`.
  - `buildPresenceByMember`: Fetches presence cards via `getMembersByIdsPg(memberIds)`.

### 14. Hierarchy Sync (`Dashboard-Backend/src/modules/hierarchy/hierarchy-sync.js`)
- **Previous Firestore Dependency**: `syncMemberHierarchyStatus` and `applyRoleChangeHierarchyEffects` called `db.collection("members").doc(memberId).get()` and `.set()`.
- **Pure SQL Fix**: Replaced with `getMemberByIdPg` and `updateMemberPg`.

### 15. Team Edit Access & Permissions (`Dashboard-Backend/src/http/team-edit-access.js`)
- **Previous Firestore Dependency**: Read `db.collection("members")` and `db.collection("team_members")`.
- **Pure SQL Fix**: Converted to PostgreSQL queries on `team_members` and `members` tables.

### 16. Dashboard Bootstrap Shell (`Dashboard-Backend/src/modules/bootstrap/bootstrap-service.js`)
- **Previous Firestore Dependency**: Read Firestore count aggregations for members and teams.
- **Pure SQL Fix**: Replaced with PostgreSQL SQL queries (`SELECT COUNT(*)::int FROM members`, `SELECT COUNT(*)::int FROM teams`, etc.).

---

## Verification Results

- **Backend Unit & Integration Test Suite**:
  - Command: `npm test` in `d:\Virtual-Tracker\Dashboard-Backend`
  - Output: **236 passed**, 0 failed across all test modules.
- **Frontend Type Safety Check**:
  - Command: `npm run type-check` in `d:\Virtual-Tracker\Dashboard-Web`
  - Output: **0 TypeScript compilation errors**.
