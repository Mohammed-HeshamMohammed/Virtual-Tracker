"use client"

import { useCallback, useEffect, useState } from "react"
import {
  ALL_MEMBER_COLS,
  DEFAULT_ENABLED_MEMBER_COLS,
  DEFAULT_MEMBER_COL_ORDER,
} from "@/features/members/config/members-config"

const ENABLED_COLS_STORAGE_KEY = "vt:members-table:enabled-cols"
const COL_ORDER_STORAGE_KEY = "vt:members-table:col-order"

const VALID_COL_KEYS = new Set<string>(ALL_MEMBER_COLS.map((col) => col.key))

function loadEnabledCols(): Set<string> {
  if (typeof window === "undefined") return new Set(DEFAULT_ENABLED_MEMBER_COLS)
  try {
    const raw = window.localStorage.getItem(ENABLED_COLS_STORAGE_KEY)
    if (!raw) return new Set(DEFAULT_ENABLED_MEMBER_COLS)
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return new Set(DEFAULT_ENABLED_MEMBER_COLS)
    const keys = parsed.filter((key): key is string => typeof key === "string" && VALID_COL_KEYS.has(key))
    return keys.length > 0 ? new Set(keys) : new Set(DEFAULT_ENABLED_MEMBER_COLS)
  } catch {
    return new Set(DEFAULT_ENABLED_MEMBER_COLS)
  }
}

function loadColOrder(): string[] {
  if (typeof window === "undefined") return [...DEFAULT_MEMBER_COL_ORDER]
  try {
    const raw = window.localStorage.getItem(COL_ORDER_STORAGE_KEY)
    if (!raw) return [...DEFAULT_MEMBER_COL_ORDER]
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return [...DEFAULT_MEMBER_COL_ORDER]
    const keys = parsed.filter((key): key is string => typeof key === "string" && VALID_COL_KEYS.has(key))
    const missing = DEFAULT_MEMBER_COL_ORDER.filter((key) => !keys.includes(key))
    return keys.length > 0 ? [...keys, ...missing] : [...DEFAULT_MEMBER_COL_ORDER]
  } catch {
    return [...DEFAULT_MEMBER_COL_ORDER]
  }
}

function persistEnabledCols(cols: Set<string>): void {
  if (typeof window === "undefined") return
  window.localStorage.setItem(ENABLED_COLS_STORAGE_KEY, JSON.stringify([...cols]))
}

function persistColOrder(order: string[]): void {
  if (typeof window === "undefined") return
  window.localStorage.setItem(COL_ORDER_STORAGE_KEY, JSON.stringify(order))
}

export function useMemberColumns() {
  const [enabledCols, setEnabledCols] = useState<Set<string>>(loadEnabledCols)
  const [colOrder, setColOrder] = useState<string[]>(loadColOrder)
  const [draggedCol, setDraggedCol] = useState<string | null>(null)
  const [sortCol, setSortCol] = useState<string | null>(null)
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc")

  useEffect(() => {
    persistEnabledCols(enabledCols)
  }, [enabledCols])

  useEffect(() => {
    persistColOrder(colOrder)
  }, [colOrder])

  function toggleMemberCol(key: string) {
    setEnabledCols((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  function handleSort(col: string) {
    if (sortCol === col) {
      setSortDir(sortDir === "asc" ? "desc" : "asc")
    } else {
      setSortCol(col)
      setSortDir("asc")
    }
  }

  function handleDragStart(col: string) {
    setDraggedCol(col)
  }

  function handleDragOver(e: React.DragEvent, col: string) {
    e.preventDefault()
  }

  function handleDrop(col: string) {
    if (!draggedCol || draggedCol === col) return
    const newOrder = [...colOrder]
    const draggedIdx = newOrder.indexOf(draggedCol)
    const targetIdx = newOrder.indexOf(col)
    newOrder.splice(draggedIdx, 1)
    newOrder.splice(targetIdx, 0, draggedCol)
    setColOrder(newOrder)
    setDraggedCol(null)
  }

  function handleDragEnd() {
    setDraggedCol(null)
  }

  return {
    enabledCols,
    colOrder,
    draggedCol,
    sortCol,
    sortDir,
    toggleMemberCol,
    handleSort,
    handleDragStart,
    handleDragOver,
    handleDrop,
    handleDragEnd,
  }
}
