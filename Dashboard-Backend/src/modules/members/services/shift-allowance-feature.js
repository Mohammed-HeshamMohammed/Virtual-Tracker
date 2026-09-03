export const SHIFT_ALLOWANCE_LIMITS_ENABLED = false;

export function normalizeShiftAllowanceFlag(stored) {
  if (!SHIFT_ALLOWANCE_LIMITS_ENABLED) return false;
  return stored === true;
}

export function assertShiftAllowanceAllowed(useShiftsForLimits) {
  if (useShiftsForLimits === true && !SHIFT_ALLOWANCE_LIMITS_ENABLED) {
    throw new Error(
      "Shift-based work allowance limits are not available yet. Settings → Schedules is coming soon.",
    );
  }
}
