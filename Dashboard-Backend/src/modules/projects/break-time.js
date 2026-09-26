// A break is time off the clock: the timer stops for it and, at the project's
// break time, ends on its own so a member who walked away is not left paused.
// The switch (`disable_break_limit`) removes that ceiling for a project.

export const BREAK_TIME_MIN_SEC = 60;
export const BREAK_TIME_MAX_SEC = 8 * 60 * 60;
/** 10 minutes - the column default in ensure-lookup-schema.js. */
export const DEFAULT_BREAK_TIME_SEC = 600;

export const BREAK_TIME_MESSAGE = "Break time must be between 1 minute and 8 hours.";

/** An error message, or null when `value` can be stored as a project's break time. */
export function validateBreakTimeSeconds(value) {
  const seconds = typeof value === "string" && value.trim() !== "" ? Number(value) : value;
  if (typeof seconds !== "number" || !Number.isFinite(seconds)) return BREAK_TIME_MESSAGE;
  if (seconds < BREAK_TIME_MIN_SEC || seconds > BREAK_TIME_MAX_SEC) return BREAK_TIME_MESSAGE;
  return null;
}

/** What gets stored: whole seconds inside the allowed range, the default when unusable. */
export function toStoredBreakTimeSeconds(value) {
  const seconds = Number(value);
  if (value === null || value === undefined || !Number.isFinite(seconds) || seconds <= 0) return DEFAULT_BREAK_TIME_SEC;
  return Math.min(BREAK_TIME_MAX_SEC, Math.max(BREAK_TIME_MIN_SEC, Math.floor(seconds)));
}

/** The pair the agent enforces, from a projects row (or the defaults when there is none). */
export function breakSettingsOf(project) {
  return {
    disableBreakLimit: Boolean(project?.disable_break_limit ?? false),
    breakTimeSeconds: toStoredBreakTimeSeconds(project?.break_time_seconds),
  };
}
