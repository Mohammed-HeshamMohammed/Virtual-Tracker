// Who on a project can actually clock in, given its Management rules.
//
// A per-person budget is "hours per person x people", and only people who can
// track time use any of it: viewers never track, users always can, and a manager
// can only while the project allows managers to record time and - when it is
// narrowed to specific managers - only the ones on that list.
//
// Mirrors `Dashboard-Web/features/projects/utils/project-trackers.ts`, which
// shows the same figure in the project form before it is saved.

/**
 * @param {{ project_role?: string|null, manager_can_track?: boolean|null,
 *           allow_project_tracking?: boolean|null, restrict_manager_tracking?: boolean|null }} row
 *   a project_members row joined with its project's two tracking switches
 */
export function isProjectTrackerRow(row) {
  const role = String(row?.project_role ?? "").trim().toLowerCase();
  if (role === "viewer") return false;
  if (role === "manager") {
    if (row.allow_project_tracking === false) return false;
    if (row.restrict_manager_tracking !== true) return true;
    return row.manager_can_track === true;
  }
  return true;
}
