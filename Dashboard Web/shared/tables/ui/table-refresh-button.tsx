"use client"

import { RefreshCw } from "lucide-react"
import { cn } from "@/shared/utils/utils"
import { TableToolbarIconButton } from "@/shared/tables/ui/table-toolbar-icon-button"

export type PeopleRefreshButtonProps = {
  onClick: () => void
  isRefreshing?: boolean
  isDark?: boolean
  title?: string
  className?: string
}

export function TableRefreshButton({
  onClick,
  isRefreshing = false,
  isDark = false,
  title = "Refresh",
  className,
}: PeopleRefreshButtonProps) {
  return (
    <TableToolbarIconButton
      onClick={onClick}
      disabled={isRefreshing}
      isDark={isDark}
      title={title}
      className={className}
    >
      <RefreshCw className={cn("h-4 w-4", isRefreshing && "animate-spin")} />
    </TableToolbarIconButton>
  )
}
