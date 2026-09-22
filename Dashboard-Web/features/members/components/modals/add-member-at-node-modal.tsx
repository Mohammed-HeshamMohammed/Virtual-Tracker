"use client"

import { useMemo, useState } from "react"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/shared/ui/dialog"
import { InviteForm } from "@/features/members/components/modals/add-members/invite-form"
import { createInvitesBulk } from "@/features/members/api/member-api"
import { listAssignableRoles } from "@/features/auth/permissions/role-hierarchy"
import { useAuth } from "@/shared/providers/app"
import { validateEmailField, validatePayRate } from "@/shared/validation"
import { MAX_INVITES_PER_SUBMIT } from "@/features/members/config/members-config"
import type { InviteFormRow, MemberRole } from "@/features/members/models/member"
import type { MemberTreeNode } from "@/features/members/services/member-tree"

/**
 * "Add member here" from the member tree (PLAN-bug-fixes-round-1.md item 16).
 * It is the ordinary email invite, plus the tree position: the backend
 * records `parent` on the invite and places the new member under them on
 * acceptance, instead of under whoever sent it. Nothing appears in the tree
 * until the invite is accepted - a pending invite is not a member yet.
 */
export function AddMemberAtNodeModal({
  parent,
  onClose,
}: {
  parent: MemberTreeNode
  onClose: () => void
}) {
  const { memberRole, user } = useAuth()
  const roleOptions = useMemo(() => listAssignableRoles(memberRole), [memberRole])
  const [rows, setRows] = useState<InviteFormRow[]>([{ email: "", payRate: "", currency: "USD" }])
  const [role, setRole] = useState<MemberRole>(roleOptions[roleOptions.length - 1] ?? "Viewer")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")
  const [done, setDone] = useState<{ count: number; emailsSent: number; inviteUrls: string[] } | null>(null)

  const updateRow = (i: number, field: "email" | "payRate" | "currency", val: string) =>
    setRows((prev) => prev.map((r, idx) => (idx === i ? { ...r, [field]: val } : r)))

  async function submit() {
    const filled = rows.filter((r) => r.email.trim())
    if (!filled.length) {
      setError("Add at least one email.")
      return
    }
    for (const r of filled) {
      const problem = validateEmailField(r.email) ?? validatePayRate(r.payRate)
      if (problem) {
        setError(`${r.email.trim()}: ${problem}`)
        return
      }
    }
    setBusy(true)
    setError("")
    try {
      const result = await createInvitesBulk(
        filled.map((r) => ({
          email: r.email.trim(),
          payRate: Number(r.payRate || 0) || undefined,
          currency: r.currency || "USD",
        })),
        role,
        {
          appOrigin: typeof window !== "undefined" ? window.location.origin : undefined,
          createdByUid: user?.uid,
          treeParentMemberId: parent.id,
        },
      )
      setDone({ count: result.invites.length, emailsSent: result.emailsSent, inviteUrls: result.inviteUrls })
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not send the invite.")
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open onOpenChange={(open) => (!open && !busy ? onClose() : undefined)}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Add member under {parent.name}</DialogTitle>
          <DialogDescription>
            They are invited by email and placed under {parent.name} in the tree once they accept.
          </DialogDescription>
        </DialogHeader>

        {done ? (
          <div className="space-y-2 text-sm">
            <p>
              {done.count} invite{done.count === 1 ? "" : "s"} created
              {done.emailsSent > 0 ? `, ${done.emailsSent} emailed` : ""}.
            </p>
            {done.emailsSent < done.count && done.inviteUrls.length > 0 ? (
              <div>
                <p className="text-xs text-slate-500">Email was not delivered for every invite - share these links:</p>
                <pre className="mt-1 max-h-32 overflow-auto whitespace-pre-wrap break-all rounded bg-slate-100 p-2 text-xs dark:bg-slate-800">
                  {done.inviteUrls.join("\n")}
                </pre>
              </div>
            ) : null}
          </div>
        ) : (
          <InviteForm
            inviteRows={rows}
            role={role}
            roleOptions={roleOptions}
            onAddRow={() =>
              setRows((prev) =>
                prev.length >= MAX_INVITES_PER_SUBMIT ? prev : [...prev, { email: "", payRate: "", currency: "USD" }],
              )
            }
            onRemoveRow={(i) => setRows((prev) => prev.filter((_, idx) => idx !== i))}
            onUpdateRow={updateRow}
            onRoleChange={setRole}
          />
        )}

        {error ? <p className="text-xs text-red-500">{error}</p> : null}

        <DialogFooter>
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="rounded-lg border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-50 disabled:opacity-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
          >
            {done ? "Close" : "Cancel"}
          </button>
          {done ? null : (
            <button
              type="button"
              onClick={() => void submit()}
              disabled={busy}
              className="rounded-lg bg-blue-600 px-3 py-2 text-xs font-semibold text-white hover:bg-blue-700 disabled:opacity-50 dark:bg-emerald-600 dark:hover:bg-emerald-500"
            >
              {busy ? "Sending…" : "Send invite"}
            </button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
