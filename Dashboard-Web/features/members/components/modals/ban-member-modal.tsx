"use client"

import { useEffect, useMemo, useState } from "react"
import { motion, useReducedMotion } from "framer-motion"
import { X } from "lucide-react"
import { cn } from "@/shared/utils/utils"
import { getMembers } from "@/features/members/api/member-api"
import { banMember } from "@/features/members/api/member-ban-api"
import type { Member } from "@/features/members/models/member"
import { useAuth } from "@/shared/providers/app"

type BanMemberModalProps = {
  member?: Member | null
  onClose: () => void
  onBanned: () => void | Promise<void>
}

const MODAL_EASE: [number, number, number, number] = [0.22, 1, 0.36, 1]
const inputCls =
  "w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-2.5 py-2 text-xs text-slate-700 dark:text-slate-200 placeholder:text-slate-400 dark:placeholder:text-slate-500 transition-colors focus:border-blue-400 dark:focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-blue-400 dark:focus:ring-emerald-500"

export function BanMemberModal({ member: presetMember, onClose, onBanned }: BanMemberModalProps) {
  const reduceMotion = useReducedMotion()
  const modalTransition = reduceMotion ? { duration: 0 } : { duration: 0.24, ease: MODAL_EASE }
  const { currentMember } = useAuth()
  const [members, setMembers] = useState<Member[]>([])
  const [loadedMembers, setLoadedMembers] = useState(false)
  const [memberId, setMemberId] = useState(presetMember?.id ?? "")
  const [reason, setReason] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // If the exit animation's deferred unmount ever stalls, this invisible fixed-inset-0
  // backdrop would keep intercepting every click/hover on the dashboard underneath it.
  const [isClosing, setIsClosing] = useState(false)
  const handleClose = () => {
    setIsClosing(true)
    onClose()
  }

  useEffect(() => {
    if (presetMember || loadedMembers) return
    void getMembers()
      .then((rows) => {
        setMembers(rows.filter((m) => m.id !== currentMember?.id && m.status !== "banned"))
        setLoadedMembers(true)
      })
      .catch(() => setLoadedMembers(true))
  }, [presetMember, loadedMembers, currentMember?.id])

  const selectedMember = presetMember ?? members.find((m) => m.id === memberId) ?? null

  const memberOptions = useMemo(
    () =>
      members.map((m) => ({
        id: m.id,
        label: `${m.name}${m.email ? ` (${m.email})` : ""}`,
      })),
    [members],
  )

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    const targetId = presetMember?.id || memberId
    const trimmedReason = reason.trim()
    if (!targetId) {
      setError("Select a member to ban.")
      return
    }
    if (!trimmedReason) {
      setError("A ban reason is required.")
      return
    }
    setBusy(true)
    setError(null)
    try {
      await banMember({ memberId: targetId, reason: trimmedReason })
      await onBanned()
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to ban member.")
    } finally {
      setBusy(false)
    }
  }

  return (
    <motion.div
      initial={reduceMotion ? false : { opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={modalTransition}
      className={cn(
        "fixed inset-0 z-70 flex items-center justify-center bg-black/50 p-6",
        isClosing && "pointer-events-none",
      )}
      onClick={handleClose}
    >
      <motion.div
        initial={reduceMotion ? false : { scale: 0.97, y: 14, opacity: 0 }}
        animate={{ scale: 1, y: 0, opacity: 1 }}
        exit={reduceMotion ? undefined : { scale: 0.97, y: 10, opacity: 0 }}
        transition={modalTransition}
        className="flex max-h-[88vh] w-full max-w-[500px] flex-col overflow-hidden rounded-2xl bg-white dark:bg-slate-900 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex shrink-0 items-center justify-between border-b border-slate-100 dark:border-slate-800 px-6 pb-4 pt-5">
          <h2 className="text-lg font-bold text-slate-800 dark:text-slate-100">Ban member</h2>
          <button onClick={handleClose} className="rounded-lg p-1.5 transition-colors hover:bg-slate-100 dark:hover:bg-slate-800" type="button">
            <X className="h-5 w-5 text-slate-500 dark:text-slate-400" />
          </button>
        </div>

        <form onSubmit={(e) => void handleSubmit(e)} className="flex min-h-0 flex-1 flex-col">
          <div className="min-h-0 flex-1 overflow-y-auto px-6 py-4 [&::-webkit-scrollbar]:hidden" style={{ scrollbarWidth: "none" }}>
            <div className="space-y-4">
              {!presetMember ? (
                <div className="space-y-1.5">
                  <label className="mb-1.5 block text-[10px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500" htmlFor="ban-member-select">
                    Member*
                  </label>
                  <select
                    id="ban-member-select"
                    value={memberId}
                    onChange={(e) => setMemberId(e.target.value)}
                    className={inputCls}
                    disabled={!loadedMembers}
                  >
                    <option value="">{loadedMembers ? "Select a member" : "Loading members…"}</option>
                    {memberOptions.map((option) => (
                      <option key={option.id} value={option.id}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </div>
              ) : (
                <div className="space-y-1.5">
                  <span className="mb-1.5 block text-[10px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500">Member</span>
                  <div className={cn(inputCls, "bg-slate-50 dark:bg-slate-800/60")}>
                    <span className="font-semibold">{presetMember.name}</span>
                    {presetMember.email ? (
                      <span className="ml-2 text-slate-500 dark:text-slate-400">{presetMember.email}</span>
                    ) : null}
                  </div>
                </div>
              )}

              <div className="space-y-1.5">
                <label className="mb-1.5 block text-[10px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500" htmlFor="ban-reason">
                  Reason*
                </label>
                <textarea
                  id="ban-reason"
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  rows={4}
                  placeholder="Describe why this member is being banned"
                  className={cn(inputCls, "resize-y")}
                />
              </div>

              {error ? <p className="text-sm text-red-600 dark:text-red-400">{error}</p> : null}
            </div>
          </div>

          <div className="flex shrink-0 items-center justify-end gap-2 border-t border-slate-100 dark:border-slate-800 px-6 py-4">
            <button
              type="button"
              onClick={handleClose}
              className="px-4 py-2 text-sm font-medium text-slate-600 dark:text-slate-300 transition-colors hover:text-slate-800 dark:hover:text-slate-100"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={busy || !selectedMember}
              className="rounded-lg bg-red-600 px-5 py-2 text-sm font-semibold text-white transition-colors hover:bg-red-700 disabled:opacity-50"
            >
              {busy ? "Banning…" : "Ban member"}
            </button>
          </div>
        </form>
      </motion.div>
    </motion.div>
  )
}
