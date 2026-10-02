"use client"

import { useCallback, useState } from "react"
import type { TreeModel } from "./model"
import { canReassign } from "./rules"

/**
 * The ask-then-do half of changing someone's manager, shared by the chart and the list: check the
 * rules, ask for confirmation, call the server, report what happened. The caller shows the
 * confirmation (`pending`, `busy`, `error`) and decides what a successful move should do next.
 */
export function useReassignFlow(options: {
  model: TreeModel
  onReassign?: (memberId: string, newParentId: string) => Promise<void>
  /** Called after the server has accepted the move. */
  onMoved?: (memberId: string, newParentId: string) => void
  notify: (text: string, tone?: "ok" | "bad") => void
}) {
  const { model, onReassign, onMoved, notify } = options
  const [pending, setPending] = useState<{ memberId: string; newParentId: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")

  const request = useCallback(
    (memberId: string, newParentId: string) => {
      const verdict = canReassign(model, memberId, newParentId)
      if (!verdict.ok) return notify(verdict.reason, "bad")
      if (verdict.noop) {
        return notify(`${model.nodeById.get(memberId)?.name ?? "They"} already report to ${model.nodeById.get(newParentId)?.name ?? "them"}.`)
      }
      setError("")
      setPending({ memberId, newParentId })
    },
    [model, notify],
  )

  const confirm = useCallback(async () => {
    if (!pending || !onReassign) return
    setBusy(true)
    setError("")
    try {
      await onReassign(pending.memberId, pending.newParentId)
      const { memberId, newParentId } = pending
      setPending(null)
      notify(`${model.nodeById.get(memberId)?.name ?? "Member"} now reports to ${model.nodeById.get(newParentId)?.name ?? "their new manager"}.`)
      onMoved?.(memberId, newParentId)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not change the manager.")
    } finally {
      setBusy(false)
    }
  }, [pending, onReassign, onMoved, model, notify])

  const cancel = useCallback(() => setPending(null), [])

  return { pending, busy, error, request, confirm, cancel }
}
