/* eslint-disable react-doctor/prefer-module-scope-pure-function */
"use client"

import { useState } from "react"
import {
  DEFAULT_CLIENT_COL_ORDER,
  DEFAULT_ENABLED_CLIENT_COLS,
} from "@/features/projects/constants"

export function useClientColumns() {
  const [enabledCols, setEnabledCols] = useState<Set<string>>(() => new Set(DEFAULT_ENABLED_CLIENT_COLS))
  const [colOrder, setColOrder] = useState<string[]>([...DEFAULT_CLIENT_COL_ORDER])
  const [sortCol, setSortCol] = useState<string | null>(null)
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc")
  const [draggedCol, setDraggedCol] = useState<string | null>(null)
  const [showColPicker, setShowColPicker] = useState(false)

  function toggleCol(key: string) {
    setEnabledCols((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  function handleSort(col: string) {
    if (sortCol === col) setSortDir(sortDir === "asc" ? "desc" : "asc")
    else {
      setSortCol(col)
      setSortDir("asc")
    }
  }

  function handleDragStart(col: string) {
    setDraggedCol(col)
  }

  function handleDragOver(e: React.DragEvent, _col: string) {
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
    sortCol,
    sortDir,
    draggedCol,
    showColPicker,
    setShowColPicker,
    toggleCol,
    handleSort,
    handleDragStart,
    handleDragOver,
    handleDrop,
    handleDragEnd,
  }
}
