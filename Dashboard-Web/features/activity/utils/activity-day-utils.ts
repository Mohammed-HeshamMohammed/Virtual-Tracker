import { useCallback, useState } from "react"

export type ActivityDayMode = "day" | "all"

export function startOfDay(d: Date): Date {
  const x = new Date(d)
  x.setHours(0, 0, 0, 0)
  return x
}

export function activityDayKey(d: Date): string {
  const x = startOfDay(d)
  const m = String(x.getMonth() + 1).padStart(2, "0")
  const day = String(x.getDate()).padStart(2, "0")
  return `${x.getFullYear()}-${m}-${day}`
}

export function formatShortDayLabel(d: Date): string {
  const today = startOfDay(new Date())
  const day = startOfDay(d)
  if (day.getTime() === today.getTime()) return "Today"
  const yesterday = new Date(today)
  yesterday.setDate(yesterday.getDate() - 1)
  if (day.getTime() === yesterday.getTime()) return "Yesterday"
  const nowYear = today.getFullYear()
  return day.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    ...(day.getFullYear() !== nowYear ? { year: "2-digit" } : {}),
  })
}

export function useActivitySelectedDay() {
  const [dayMode, setDayMode] = useState<ActivityDayMode>("day")
  const [selectedDay, setSelectedDayState] = useState<Date>(() => startOfDay(new Date()))
  const [showDayPicker, setShowDayPicker] = useState(false)

  const setSelectedDay = useCallback((day: Date) => {
    setDayMode("day")
    setSelectedDayState(startOfDay(day))
  }, [])

  const setAllDays = useCallback(() => {
    setDayMode("all")
    setShowDayPicker(false)
  }, [])

  const goToToday = useCallback(() => {
    setDayMode("day")
    setSelectedDayState(startOfDay(new Date()))
    setShowDayPicker(false)
  }, [])

  const goToYesterday = useCallback(() => {
    setDayMode("day")
    const yesterday = startOfDay(new Date())
    yesterday.setDate(yesterday.getDate() - 1)
    setSelectedDayState(yesterday)
    setShowDayPicker(false)
  }, [])

  const openDayPicker = useCallback(() => {
    setShowDayPicker(true)
  }, [])

  const selectedDayLabel = dayMode === "all" ? "All days" : formatShortDayLabel(selectedDay)
  const isSelectedToday =
    dayMode === "day" && activityDayKey(selectedDay) === activityDayKey(new Date())
  const dayKey = dayMode === "all" ? "all" : activityDayKey(selectedDay)

  const shiftSelectedDay = useCallback((delta: number) => {
    if (dayMode === "all") return
    setSelectedDayState((prev) => {
      const next = new Date(prev)
      next.setDate(next.getDate() + delta)
      const today = startOfDay(new Date())
      if (startOfDay(next).getTime() > today.getTime()) return today
      return startOfDay(next)
    })
  }, [dayMode])

  return {
    dayMode,
    setDayMode,
    setAllDays,
    goToToday,
    goToYesterday,
    openDayPicker,
    selectedDay,
    setSelectedDay,
    showDayPicker,
    setShowDayPicker,
    selectedDayLabel,
    isSelectedToday,
    dayKey,
    shiftSelectedDay,
  }
}
