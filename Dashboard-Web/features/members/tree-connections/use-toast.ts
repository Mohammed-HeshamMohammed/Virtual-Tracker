"use client"

import { useCallback, useEffect, useRef, useState } from "react"

export type Toast = { text: string; tone: "ok" | "bad" }

/** One short message at a time that clears itself. */
export function useToast(durationMs = 3800) {
  const [toast, setToast] = useState<Toast | null>(null)
  const timer = useRef<number | null>(null)
  const show = useCallback(
    (text: string, tone: Toast["tone"] = "ok") => {
      setToast({ text, tone })
      if (timer.current) window.clearTimeout(timer.current)
      timer.current = window.setTimeout(() => setToast(null), durationMs)
    },
    [durationMs],
  )
  useEffect(() => () => {
    if (timer.current) window.clearTimeout(timer.current)
  }, [])
  return { toast, show }
}
