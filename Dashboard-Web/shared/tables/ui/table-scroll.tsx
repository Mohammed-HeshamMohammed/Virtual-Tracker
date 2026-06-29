"use client"

import { useRef, type ReactNode, type RefObject } from "react"
import { cn } from "@/shared/utils/utils"
import { useDistributedRowHeight } from "@/shared/tables/hooks/use-distributed-row-height"

export type PeopleTableScrollProps = {
  fillsRemaining?: boolean
  visibleRowCount?: number
  children: (distributedRowHeight: number | undefined) => ReactNode
  className?: string
  scrollRef?: RefObject<HTMLDivElement | null>
}

function assignRef<T>(ref: RefObject<T | null> | undefined, value: T | null) {
  if (!ref) return
  ref.current = value
}

/** Table body wrapper — distributes row height to fill available space without vertical scroll. */
export function TableScroll({
  children,
  className,
  scrollRef,
  visibleRowCount = 0,
}: PeopleTableScrollProps) {
  const innerRef = useRef<HTMLDivElement>(null)
  const rowHeight = useDistributedRowHeight(innerRef, visibleRowCount)

  return (
    <div
      ref={(node) => {
        innerRef.current = node
        assignRef(scrollRef, node)
      }}
      className={cn("flex min-h-0 flex-1 flex-col overflow-hidden", className)}
    >
      {children(rowHeight)}
    </div>
  )
}
