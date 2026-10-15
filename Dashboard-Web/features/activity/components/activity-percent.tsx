import { getActivityTextColor } from "@/features/activity/components/utils"
import { cn } from "@/shared/utils/utils"

/**
 * An average of screenshot activity levels, as on the Screenshots page - so the Apps and
 * URLs pages show the same activity, corrections included. "-" when no screenshot was
 * taken there, which is not the same as 0%.
 */
export function ActivityPercent({ value, where }: { value: number | null | undefined; where: string }) {
  if (value == null) {
    return (
      <span className="text-sm text-slate-400 dark:text-slate-500" title={`No screenshots were taken ${where}`}>
        -
      </span>
    )
  }
  return (
    <span
      className={cn("text-sm font-semibold tabular-nums", getActivityTextColor(value))}
      title={`Average activity of the screenshots taken ${where}`}
    >
      {value}%
    </span>
  )
}

/** The same figure for a spreadsheet cell. */
export function activityCell(value: number | null | undefined): string {
  return value == null ? "" : `${value}%`
}
