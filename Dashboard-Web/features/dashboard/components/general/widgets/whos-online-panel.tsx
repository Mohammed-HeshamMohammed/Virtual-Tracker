"use client"

import { useMemo, useState } from "react"
import { Users } from "lucide-react"
import { useGeneralDashboard } from "@/features/dashboard/components/general/context/general-dashboard-context"
import { PanelShell } from "@/features/dashboard/components/general/components/widget-shell"
import { MemberRow } from "@/features/dashboard/components/general/components/member-row"
import { MemberDetailDialog } from "@/features/dashboard/components/general/components/member-detail-dialog"
import type { OnlineMember } from "@/features/dashboard/components/general/constants"

export function WhosOnlinePanel() {
  const { viewData, loading, error, retry } = useGeneralDashboard()
  const members = viewData?.onlineMembers ?? []
  const [selected, setSelected] = useState<OnlineMember | null>(null)

  const counts = useMemo(() => {
    const working = members.filter((m) => m.status === "Working").length
    const idle = members.filter((m) => m.status === "Idle").length
    return { working, idle }
  }, [members])

  return (
    <>
      <PanelShell
        title="Team presence"
        subtitle={`${counts.working} working · ${counts.idle} idle`}
        icon={<Users className="h-5 w-5" />}
        iconClassName="bg-cyan-500"
        loading={loading}
        error={error}
        onRetry={retry}
        empty={!loading && members.length === 0}
        emptyMessage="No team members in scope."
        action={
          <div className="hidden items-center gap-3 text-[11px] font-medium text-slate-500 dark:text-slate-400 sm:flex">
            <Legend color="bg-emerald-500" label="Working" />
            <Legend color="bg-amber-500" label="Idle" />
            <Legend color="bg-slate-400" label="Offline" />
          </div>
        }
      >
        <ul className="space-y-0.5">
          {members.map((member) => (
            <MemberRow key={member.id} member={member} onSelect={() => setSelected(member)} />
          ))}
        </ul>
      </PanelShell>
      <MemberDetailDialog member={selected} onClose={() => setSelected(null)} />
    </>
  )
}

function Legend({ color, label }: { color: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={`h-2 w-2 rounded-full ${color}`} />
      {label}
    </span>
  )
}
