"use client"

import { useRef, type Dispatch, type SetStateAction } from "react"

export function useRangeSelect() {
  const lastClickedId = useRef<string | null>(null)

  function toggle(
    id: string,
    shiftKey: boolean,
    orderedIds: string[],
    setSelected: Dispatch<SetStateAction<Set<string>>>,
  ) {
    if (shiftKey && lastClickedId.current) {
      const from = orderedIds.indexOf(lastClickedId.current)
      const to = orderedIds.indexOf(id)
      if (from !== -1 && to !== -1) {
        const [start, end] = from < to ? [from, to] : [to, from]
        const range = orderedIds.slice(start, end + 1)
        setSelected((prev) => {
          const next = new Set(prev)
          for (const rid of range) next.add(rid)
          return next
        })
        lastClickedId.current = id
        return
      }
    }
    setSelected((prev) => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
    lastClickedId.current = id
  }

  return toggle
}
