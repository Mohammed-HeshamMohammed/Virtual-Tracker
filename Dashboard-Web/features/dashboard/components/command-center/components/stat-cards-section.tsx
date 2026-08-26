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
      Icon: Clock,      iconBg: "bg-emerald-50 dark:bg-emerald-950/60 text-emerald-600 dark:text-emerald-400 border border-emerald-200/80 dark:border-emerald-800/80",
      // Real week-over-week change; hidden when there is no prior week to
      // compare against. This was hardcoded "+12%" for every org.
      badge:
        d.stats.timeWorkedTrendPercent === null
          ? ""
          : `${d.stats.timeWorkedTrendPercent > 0 ? "+" : ""}${d.stats.timeWorkedTrendPercent}%`,
      badgeColor:
        (d.stats.timeWorkedTrendPercent ?? 0) < 0
          ? "text-rose-600 dark:text-rose-400 bg-rose-50 dark:bg-rose-950/60 px-2 py-0.5 rounded-full border border-rose-200/60 dark:border-rose-800/60"
          : "text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/60 px-2 py-0.5 rounded-full border border-emerald-200/60 dark:border-emerald-800/60",
      label: "Total Time Worked", value: d.stats.timeWorked,
    },
    {
      Icon: Users,      iconBg: "bg-blue-50 dark:bg-blue-950/60 text-blue-600 dark:text-blue-400 border border-blue-200/80 dark:border-blue-800/80",
      badge: `${d.stats.activeMembers} active`, badgeColor: "text-slate-500 dark:text-slate-400 bg-slate-100 dark:bg-slate-800 px-2 py-0.5 rounded-full",
      label: "Active Members",    value: `${d.stats.activeMembers} / ${d.stats.totalMembers}`,
    },
    {
      Icon: CreditCard, iconBg: "bg-amber-50 dark:bg-amber-950/60 text-amber-600 dark:text-amber-400 border border-amber-200/80 dark:border-amber-800/80",
      badge: d.stats.budgetLabel, badgeColor: "text-slate-500 dark:text-slate-400 bg-slate-100 dark:bg-slate-800 px-2 py-0.5 rounded-full",
      label: "Budget Spent",      value: `${d.stats.budgetPercent}%`,
      barPercent: d.stats.budgetPercent, barColor: "bg-amber-500 dark:bg-amber-400",
    },
    {
      Icon: Zap,        iconBg: "bg-purple-50 dark:bg-purple-950/60 text-purple-600 dark:text-purple-400 border border-purple-200/80 dark:border-purple-800/80",
      badge: d.stats.activityBadge, badgeColor: "text-purple-600 dark:text-purple-400 bg-purple-50 dark:bg-purple-950/60 px-2 py-0.5 rounded-full border border-purple-200/60 dark:border-purple-800/60",
      label: "Avg Team Activity", value: `${d.stats.activityPercent}%`,
      barPercent: d.stats.activityPercent, barColor: "bg-purple-500 dark:bg-purple-400",
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
            className="rounded-3xl p-6 cursor-default bg-white/90 dark:bg-slate-900/90 shadow-sm border border-slate-200/80 dark:border-slate-800 backdrop-blur-xl transition-all hover:shadow-md hover:-translate-y-0.5"
          >
            <div className="flex justify-between items-start mb-4">
              <div className={`p-2.5 ${card.iconBg} rounded-xl shadow-inner`}>
                <card.Icon className="w-5 h-5" />
               </div>
              {card.badge ? (
                <span className={`text-xs font-bold ${card.badgeColor}`}>{card.badge}</span>
              ) : null}
            </div>
            <p className="text-sm font-semibold text-slate-500 dark:text-slate-400">{card.label}</p>
            <p className="text-3xl font-black mt-1 text-slate-900 dark:text-slate-100 tracking-tight">{card.value}</p>
            {"barPercent" in card && card.barPercent !== undefined && (
              <div className="w-full h-1.5 bg-slate-100 dark:bg-slate-800 rounded-full mt-4 overflow-hidden">
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
