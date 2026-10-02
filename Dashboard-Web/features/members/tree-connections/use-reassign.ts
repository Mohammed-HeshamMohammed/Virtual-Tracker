"use client"

import { useCallback, useState } from "react"
import type { TreeModel } from "./model"
import { canReassign } from "./rules"

export type PendingMove = {
  /** Who will move: only those the rules allow. */
  memberIds: string[]
  newParentId: string
  /** Asked for, but not movable - with the reason. Shown in the confirmation. */
  skipped: { memberId: string; reason: string }[]
}

export type BulkResult = { moved: number; unchanged: number; skipped: { memberId: string; message: string }[] }

/**
 * The ask-then-do half of changing someone's manager, shared by the chart and the list: check the
 * rules, ask for confirmation, call the server, report what happened. One member or a whole group
 * dragged onto a manager. The caller shows the confirmation (`pending`, `busy`, `error`) and
 * decides what a successful move should do next.
 */
export function useReassignFlow(options: {
  model: TreeModel
  onReassign?: (memberId: string, newParentId: string) => Promise<void>
  /** Several at once; without it a group is moved one member at a time through `onReassign`. */
  onReassignMany?: (memberIds: string[], newParentId: string) => Promise<BulkResult>
  /** Called after the server has accepted the move, with the members that actually moved. */
  onMoved?: (memberIds: string[], newParentId: string) => void
  notify: (text: string, tone?: "ok" | "bad") => void
}) {
  const { model, onReassign, onReassignMany, onMoved, notify } = options
  const [pending, setPending] = useState<PendingMove | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")

  const request = useCallback(
    (members: string | string[], newParentId: string) => {
      const ids = [...new Set(Array.isArray(members) ? members : [members])]
      const movable: string[] = []
      const skipped: PendingMove["skipped"] = []
      let alreadyThere = 0
      for (const id of ids) {
        const verdict = canReassign(model, id, newParentId)
        if (!verdict.ok) skipped.push({ memberId: id, reason: verdict.reason })
        else if (verdict.noop) alreadyThere += 1
        else movable.push(id)
      }
      const parentName = model.nodeById.get(newParentId)?.name ?? "them"
      if (movable.length === 0) {
        if (skipped.length > 0) return notify(ids.length === 1 ? skipped[0].reason : `No one can move there: ${skipped[0].reason}`, "bad")
        return notify(ids.length === 1 ? `${model.nodeById.get(ids[0])?.name ?? "They"} already report to ${parentName}.` : `They already report to ${parentName}.`)
      }
      setError("")
      setPending({ memberIds: movable, newParentId, skipped })
      void alreadyThere
    },
    [model, notify],
  )

  const confirm = useCallback(async () => {
    if (!pending) return
    setBusy(true)
    setError("")
    try {
      const { memberIds, newParentId } = pending
      let moved = memberIds
      let leftBehind = pending.skipped.length
      if (memberIds.length === 1) {
        if (!onReassign) return
        await onReassign(memberIds[0], newParentId)
      } else if (onReassignMany) {
        const result = await onReassignMany(memberIds, newParentId)
        const refused = new Set(result.skipped.map((s) => s.memberId))
        moved = memberIds.filter((id) => !refused.has(id))
        leftBehind += refused.size
        if (result.moved + result.unchanged === 0) throw new Error(result.skipped[0]?.message ?? "Could not move these members.")
      } else if (onReassign) {
        for (const id of memberIds) await onReassign(id, newParentId)
      } else {
        return
      }
      setPending(null)
      const parentName = model.nodeById.get(newParentId)?.name ?? "their new manager"
      const who = moved.length === 1 ? (model.nodeById.get(moved[0])?.name ?? "Member") : `${moved.length} members`
      notify(`${who} now ${moved.length === 1 ? "reports" : "report"} to ${parentName}.${leftBehind > 0 ? ` ${leftBehind} could not move.` : ""}`)
      onMoved?.(moved, newParentId)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not change the manager.")
    } finally {
      setBusy(false)
    }
  }, [pending, onReassign, onReassignMany, onMoved, model, notify])

  const cancel = useCallback(() => setPending(null), [])

  return { pending, busy, error, request, confirm, cancel }
}
