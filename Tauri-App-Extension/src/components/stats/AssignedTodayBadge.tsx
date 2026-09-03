import type { MemberLimits } from "../../types";
import { fmtHours } from "../../utils/formatters";

type AssignedTodayBadgeProps = {
  memberLimits: MemberLimits | null;
  assignedTodayLabel: string;
  assignedTaskCountLabel: string;
  assignedCarriedLabel: string;
};

export function AssignedTodayBadge({
  memberLimits,
  assignedTodayLabel,
  assignedTaskCountLabel,
  assignedCarriedLabel,
}: AssignedTodayBadgeProps) {
  if (!memberLimits) return null;
  const { plannedSeconds, deferredSeconds } = memberLimits.assignedToday;
  const detail = [
    assignedTaskCountLabel,
    `${fmtHours(plannedSeconds)} fits today`,
    deferredSeconds > 0 ? `${fmtHours(deferredSeconds)} moves on` : "",
    assignedCarriedLabel,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <div className="assigned-today-badge" title={detail || undefined}>
      <svg viewBox="0 0 24 24" aria-hidden="true" className="vt-icon">
        <path
          fill="currentColor"
          d="M9 2a1 1 0 0 0-1 1v1H6a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2h-2V3a1 1 0 1 0-2 0v1H9V3a1 1 0 0 0-1-1Zm-3 6h12v11H6V8Z"
        />
      </svg>
      <span className="assigned-today-badge-label">Assigned today</span>
      <span className="assigned-today-badge-value">{assignedTodayLabel}</span>
    </div>
  );
}
