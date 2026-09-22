"use client"

import { useEffect, useState, type ReactNode } from "react"
import { useAuth } from "@/shared/providers/app"
import { isClientRole } from "@/features/auth/permissions/team-member-assign-policy"
import { ClientModal } from "@/features/clients/components/modals/client-modal"
import {
  completeClientSelfSetup,
  fetchClientSelfSetupStatus,
  type ClientSelfSetupStatus,
} from "@/features/clients/api/client-api"

type GateState =
  | { kind: "checking" }
  | { kind: "required"; prefill: NonNullable<ClientSelfSetupStatus["prefill"]> }
  | { kind: "done" }

/**
 * A member with the Client role fills in their own client details (the
 * Clients page's Add client form, cut down - see ClientModal's selfSetup)
 * before the dashboard opens. How they became a Client doesn't matter:
 * invited as one, migrated/merged in as one, or switched to Client later.
 * The effect re-runs when the role changes, so a mid-session switch to
 * Client brings the form up without a reload.
 *
 * The backend decides whether it is needed: never when a client record is
 * already linked to them, and an admin-made record is linked by email
 * first rather than asking twice.
 *
 * Fails OPEN: if the check itself errors, the dashboard loads. This is data
 * collection, not an access control, and a flaky endpoint must not lock a
 * client out of everything.
 */
export function ClientSelfSetupGate({ children }: { children: ReactNode }) {
  const { memberRole, memberId } = useAuth()
  const isClient = isClientRole(memberRole ?? "")
  const [state, setState] = useState<GateState>(() => (isClient ? { kind: "checking" } : { kind: "done" }))

  useEffect(() => {
    if (!isClient || !memberId) {
      setState({ kind: "done" })
      return
    }
    let cancelled = false
    setState({ kind: "checking" })
    fetchClientSelfSetupStatus()
      .then((status) => {
        if (cancelled) return
        setState(
          status.required
            ? { kind: "required", prefill: status.prefill ?? { name: "", email: "", phone: "" } }
            : { kind: "done" },
        )
      })
      .catch(() => {
        if (!cancelled) setState({ kind: "done" })
      })
    return () => {
      cancelled = true
    }
  }, [isClient, memberId])

  if (state.kind === "done") return <>{children}</>

  if (state.kind === "checking") {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50 dark:bg-[#0c1324]">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-slate-300 border-t-blue-600 dark:border-slate-700 dark:border-t-emerald-500" />
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-[#0c1324]">
      <ClientModal
        selfSetup={{ prefill: state.prefill }}
        members={[]}
        onClose={() => {}}
        onSave={async (form) => {
          await completeClientSelfSetup(form)
          setState({ kind: "done" })
        }}
      />
    </div>
  )
}
