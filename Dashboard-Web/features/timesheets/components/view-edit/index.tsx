"use client"

import { useEffect, useMemo, useState } from "react"
import { motion } from "framer-motion"
import { ClipboardCheck, AlertTriangle } from "lucide-react"
import { useAuth, useTheme } from "@/shared/providers/app"
import { canAccessReviewCenter, canReviewAssignments, isEmployeeRole } from "@/features/auth"
import { getMembers, getProjects } from "@/infrastructure/api"
import { MyTeamScopePeopleButton } from "@/features/members/components/my-team-scope-controls"
import { usePeopleTeamScope } from "@/features/members/context/people-team-scope-context"
import { ReviewQueueTable } from "@/features/timesheets/components/view-edit/components/ReviewQueueTable"
import { sectionHeaderEnter, contentEnter, badgePop } from "@/features/timesheets/components/view-edit/lib/motion"

export function TimesheetsViewEdit() {
  const { isDark } = useTheme()
  const { memberRole } = useAuth()
  // Employee tier reads this queue too, scoped server-side to their own
  // assignments only - they just never get the approve/reject controls.
  const canReview = canAccessReviewCenter(memberRole) || isEmployeeRole(memberRole)
  const canApproveReject = canReviewAssignments(memberRole)
  const { canToggleMyTeam, myTeamOnly, teamMemberIds, teamMemberIdsLoading } = usePeopleTeamScope()
  const [memberOptions, setMemberOptions] = useState<{ id: string; name: string }[]>([])
  const [projectOptions, setProjectOptions] = useState<{ id: string; name: string }[]>([])

  const scopedMemberOptions = useMemo(() => {
    if (!canToggleMyTeam || !myTeamOnly || teamMemberIdsLoading) return memberOptions
    if (teamMemberIds.size === 0) return []
    return memberOptions.filter((member) => teamMemberIds.has(member.id))
  }, [memberOptions, canToggleMyTeam, myTeamOnly, teamMemberIds, teamMemberIdsLoading])

  useEffect(() => {
    if (!canReview) return
    const ac = new AbortController()
    Promise.all([
      getMembers({ signal: ac.signal }).catch(() => []),
      getProjects({ signal: ac.signal }).catch(() => []),
    ]).then(([members, projects]) => {
      setMemberOptions(members.map((m) => ({ id: m.id, name: m.name })))
      setProjectOptions(projects.map((p) => ({ id: p.id, name: p.name })))
    })
    return () => ac.abort()
  }, [canReview])

  if (!canReview) {
    return (
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3 }}
        className="flex min-h-[50vh] items-center justify-center p-8"
      >
        <p className="text-sm text-slate-500">You do not have permission to access the review center.</p>
      </motion.div>
    )
  }

  return (
    <div className="space-y-8 p-4 md:p-6">
      <motion.section {...contentEnter(0.05)} className="space-y-4">
        <motion.div {...sectionHeaderEnter(0.08)} className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-amber-50 dark:bg-amber-950/60 border border-amber-200/80 dark:border-amber-800/80">
              <ClipboardCheck className="h-5 w-5 text-amber-600 dark:text-amber-400" />
            </div>
            <h2 className="text-lg font-bold tracking-tight text-slate-900 dark:text-slate-100">Needs Review</h2>
            <motion.span
              {...badgePop}
              className="rounded-full bg-amber-100 dark:bg-amber-950/80 border border-amber-200/80 dark:border-amber-800/80 px-2.5 py-0.5 text-xs font-semibold text-amber-800 dark:text-amber-300"
            >
              In Review
            </motion.span>
          </div>
          <MyTeamScopePeopleButton isDark={isDark} />
        </motion.div>
        <ReviewQueueTable
          memberOptions={scopedMemberOptions}
          projectOptions={projectOptions}
          variant="needs-review"
          canReviewAssignments={canApproveReject}
          myTeamOnly={canToggleMyTeam && myTeamOnly}
          teamMemberIds={teamMemberIds}
          teamMemberIdsLoading={teamMemberIdsLoading}
        />
      </motion.section>

      <motion.section {...contentEnter(0.12)} className="space-y-4">
        <motion.div {...sectionHeaderEnter(0.15)} className="flex items-center gap-2.5">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-rose-50 dark:bg-rose-950/60 border border-rose-200/80 dark:border-rose-800/80">
            <AlertTriangle className="h-5 w-5 text-rose-600 dark:text-rose-400" />
          </div>
          <h2 className="text-lg font-bold tracking-tight text-slate-900 dark:text-slate-100">Priority Monitor</h2>
          <motion.span
            {...badgePop}
            className="rounded-full bg-rose-100 dark:bg-rose-950/80 border border-rose-200/80 dark:border-rose-800/80 px-2.5 py-0.5 text-xs font-semibold text-rose-800 dark:text-rose-300"
          >
            High / Urgent
          </motion.span>
        </motion.div>
        <ReviewQueueTable
          memberOptions={scopedMemberOptions}
          projectOptions={projectOptions}
          variant="priority-monitor"
          canReviewAssignments={canApproveReject}
          myTeamOnly={canToggleMyTeam && myTeamOnly}
          teamMemberIds={teamMemberIds}
          teamMemberIdsLoading={teamMemberIdsLoading}
        />
      </motion.section>
    </div>
  )
}
