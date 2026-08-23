// Shared by the create-time auto-task (routes.js) and the startup backfill
// (cold-calling-task-backfill.js) for projects created before that feature
// existed - kept in one place so the title format can't drift between them.

/** "Banna Estate" -> "B.E." Falls back to the first two letters for a single-word name. */
export function projectInitials(name) {
  const words = String(name || "").trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "";
  if (words.length === 1) return `${words[0].slice(0, 2).toUpperCase()}.`;
  return `${words.map((w) => w[0].toUpperCase()).join(".")}.`;
}

export function coldCallingTaskTitle(projectName) {
  const initials = projectInitials(projectName);
  return initials ? `${initials} Cold Calling` : "Cold Calling";
}
