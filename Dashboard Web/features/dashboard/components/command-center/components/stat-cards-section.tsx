/* eslint-disable react-doctor/use-lazy-motion */
"use client"

import { motion, AnimatePresence } from "framer-motion"
import { Clock, Users, CreditCard, Zap } from "lucide-react"
import type { ProjectData } from "@/features/dashboard/components/command-center/constants"

interface StatCardsSectionProps {
  project: ProjectData
}

export function StatCardsSection({ project }: StatCardsSectionProps) {
  const d = project
  const statCards = [
    {
      Icon: Clock,      iconBg: "bg-emerald-50", iconColor: "text-emerald-600",
      badge: "+12%",    badgeColor: "text-emerald-500",
      label: "Total Time Worked", value: d.stats.timeWorked,
    },
    {
      Icon: Users,      iconBg: "bg-blue-50",   iconColor: "text-blue-600",
      badge: `${d.stats.activeMembers} active`, badgeColor: "text-slate-400",
      label: "Active Members",    value: `${d.stats.activeMembers} / ${d.stats.totalMembers}`,
    },
    {
      Icon: CreditCard, iconBg: "bg-amber-50",  iconColor: "text-amber-600",
      badge: d.stats.budgetLabel, badgeColor: "text-slate-400",
      label: "Budget Spent",      value: `${d.stats.budgetPercent}%`,
      barPercent: d.stats.budgetPercent, barColor: "bg-amber-500",
    },
    {
      Icon: Zap,        iconBg: "bg-purple-50", iconColor: "text-purple-600",
      badge: d.stats.activityBadge, badgeColor: "text-purple-600",
      label: "Avg Team Activity", value: `${d.stats.activityPercent}%`,
      barPercent: d.stats.activityPercent, barColor: "bg-purple-500",
    },
  ] as const

  return (
    <AnimatePresence mode="wait">
      <motion.div
        key={d.id + "-stats"}
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: 20 }}
        transition={{ duration: 0.3 }}
        className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6"
      >
        {statCards.map((card, i) => (
          <motion.div
            key={`${d.id}-${card.label}`}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3, delay: i * 0.1 }}
            className="rounded-3xl p-6 cursor-default bg-white shadow-sm border border-slate-100"
          >
            <div className="flex justify-between items-start mb-4">
              <div className={`p-2 ${card.iconBg} ${card.iconColor} rounded-xl`}>
                <card.Icon className="w-5 h-5" />
               </div>
              <span className={`text-xs font-bold ${card.badgeColor}`}>{card.badge}</span>
            </div>
            <p className="text-sm font-semibold text-slate-500">{card.label}</p>
            <p className="text-3xl font-black mt-1 text-slate-900">{card.value}</p>
            {"barPercent" in card && card.barPercent !== undefined && (
              <div className="w-full h-1.5 bg-slate-100 rounded-full mt-4 overflow-hidden">
                <motion.div
                  key={d.id + "-bar-" + i}
                  initial={{ width: 0 }}
                  animate={{ width: `${card.barPercent}%` }}
                  transition={{ duration: 0.7, delay: 0.1 }}
                  className={`h-full ${card.barColor} rounded-full`}
                />
              </div>
            )}
          </motion.div>
        ))}
      </motion.div>
    </AnimatePresence>
  )
}
