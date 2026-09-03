"use client"

import { useState } from "react"

export function useInviteColumns() {
  const [inviteSortCol, setInviteSortCol] = useState<string | null>(null)
  const [inviteSortDir, setInviteSortDir] = useState<"asc" | "desc">("asc")
  const [inviteColOrder, setInviteColOrder] = useState<string[]>([
    "email",
    "role",
    "projects",
    "payment",
    "weeklyLimit",
    "status",
  ])
  const [draggedInviteCol, setDraggedInviteCol] = useState<string | null>(null)

  function handleInviteSort(col: string) {
    if (inviteSortCol === col) {
      setInviteSortDir(inviteSortDir === "asc" ? "desc" : "asc")
    } else {
      setInviteSortCol(col)
      setInviteSortDir("asc")
    }
  }

  function handleInviteDragStart(col: string) {
    setDraggedInviteCol(col)
  }

  function handleInviteDragOver(e: React.DragEvent, col: string) {
    e.preventDefault()
  }

  function handleInviteDrop(col: string) {
    if (!draggedInviteCol || draggedInviteCol === col) return
    const newOrder = [...inviteColOrder]
    const draggedIdx = newOrder.indexOf(draggedInviteCol)
    const targetIdx = newOrder.indexOf(col)
    newOrder.splice(draggedIdx, 1)
    newOrder.splice(targetIdx, 0, draggedInviteCol)
    setInviteColOrder(newOrder)
    setDraggedInviteCol(null)
  }

  function handleInviteDragEnd() {
    setDraggedInviteCol(null)
  }

  return {
    inviteSortCol,
    inviteSortDir,
    inviteColOrder,
    draggedInviteCol,
    handleInviteSort,
    handleInviteDragStart,
    handleInviteDragOver,
    handleInviteDrop,
    handleInviteDragEnd,
  }
}
