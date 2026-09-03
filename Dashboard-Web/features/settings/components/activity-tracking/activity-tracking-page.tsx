"use client"

import { useState as useComponentState } from "react"
import { motion } from "framer-motion"
import { ChevronDown, Clock, FileText, MousePointer, Monitor, Globe, ArrowLeft } from "lucide-react"
import { cn } from "@/shared/utils/utils"

interface ActivityTrackingSettingsProps {
  onNavigate?: (id: string) => void
}

type Section = "overview" | "timesheets" | "activity" | "screenshots" | "urls" | "apps"

function Toggle({ checked, onChange, label, description }: { 
  checked: boolean
  onChange: () => void
  label: string
  description?: string
}) {
  return (
    <div className="flex items-start justify-between gap-4">
      <div className="flex-1">
        <h4 className="text-sm font-medium text-slate-800">{label}</h4>
        {description && <p className="text-xs text-slate-500 mt-1">{description}</p>}
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={onChange}
        className={cn(
          "relative inline-flex h-6 w-11 shrink-0 rounded-full border-2 border-transparent transition-colors duration-200",
          checked ? "bg-blue-500" : "bg-slate-200"
        )} aria-label="Interactive control"
      >
        <span
          className={cn(
            "inline-block h-5 w-5 transform rounded-full bg-white shadow-sm transition-transform duration-200",
            checked ? "translate-x-5" : "translate-x-0"
          )}
        />
      </button>
    </div>
  )
}

function Card({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={cn("bg-white rounded-xl border border-slate-200 shadow-sm", className)}>
      {children}
    </div>
  )
}
const payPeriodOptions = [
    { value: "weekly", label: "Weekly" },
    { value: "bi-weekly", label: "Bi-weekly" },
    { value: "twice-per-month", label: "Twice per month" },
    { value: "monthly", label: "Monthly" },
  ]

function TimesheetsSection() {
  const [manualTimeRequests, setManualTimeRequests] = useComponentState(false)
  const [timesheetApprovals, setTimesheetApprovals] = useComponentState(true)
  const [autoSubmit, setAutoSubmit] = useComponentState(false)
  const [payPeriod, setPayPeriod] = useComponentState("weekly")
  const [dropdownOpen, setDropdownOpen] = useComponentState(false)
  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3 mb-6">
        <div className="w-10 h-10 rounded-lg bg-blue-100 flex items-center justify-center">
          <Clock className="w-5 h-5 text-blue-600" />
        </div>
        <div>
          <h2 className="text-lg font-semibold text-slate-800">Timesheets</h2>
          <p className="text-sm text-slate-500">Configure timesheet tracking and approval settings</p>
        </div>
      </div>

      <Card className="p-5">
        <Toggle
          checked={manualTimeRequests}
          onChange={() => setManualTimeRequests(!manualTimeRequests)}
          label="Manual time requests"
          description="Require manager approval when team members add manual time entries. This ensures accurate project tracking, payroll, and compliance."
        />
      </Card>

      <Card className="p-5">
        <div className="space-y-5">
          <Toggle
            checked={timesheetApprovals}
            onChange={() => setTimesheetApprovals(!timesheetApprovals)}
            label="Timesheet approvals"
            description="Require members to submit their timesheets for approval before payroll is processed."
          />

          {timesheetApprovals && (
            <div className="pt-4 border-t border-slate-100 space-y-4">
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
                  Pay period
                </label>
                <div className="relative">
                  <button
                    type="button"
                    onClick={() => setDropdownOpen(!dropdownOpen)}
                    className="w-full flex items-center justify-between px-3 py-2.5 bg-white border border-slate-200 rounded-lg text-sm text-slate-700 hover:border-slate-300 transition-colors"
                  >
                    <span>{payPeriodOptions.find(o => o.value === payPeriod)?.label}</span>
                    <ChevronDown className={cn("w-4 h-4 text-slate-400 transition-transform", dropdownOpen && "rotate-180")} />
                  </button>
                  {dropdownOpen && (
                    <>
                      <div className="fixed inset-0 z-10" onClick={() => setDropdownOpen(false)} role="button" tabIndex={0} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); e.currentTarget.click(); } }} />
                      <div className="absolute left-0 top-full mt-1 z-20 w-full bg-white rounded-xl border border-slate-200 shadow-lg py-1">
                        {payPeriodOptions.map((opt) => (
                          <button
                            key={opt.value}
                            type="button"
                            onClick={() => {
                              setPayPeriod(opt.value)
                              setDropdownOpen(false)
                            }}
                            className={cn(
                              "w-full flex items-center justify-between px-3 py-2 text-sm hover:bg-slate-50 transition-colors",
                              opt.value === payPeriod && "bg-blue-50 text-blue-600"
                            )}
                          >
                            {opt.label}
                          </button>
                        ))}
                      </div>
                    </>
                  )}
                </div>
              </div>

              <Toggle
                checked={autoSubmit}
                onChange={() => setAutoSubmit(!autoSubmit)}
                label="Automatically set up new members"
                description="New members will automatically be set up with timesheet approvals and this pay period."
              />
            </div>
          )}
        </div>
      </Card>

      <div className="flex justify-end">
        <button className="px-6 py-2.5 text-sm font-medium text-white bg-blue-500 rounded-lg hover:bg-blue-600 transition-colors" type="button">
          Save changes
        </button>
      </div>
    </div>
  )
}
const sections = [
    {
      id: "timesheets",
      title: "Timesheets",
      description: "Configure timesheet tracking and approval settings",
      icon: Clock,
      color: "blue",
    },
    {
      id: "activity",
      title: "Activity Tracking",
      description: "Set up activity monitoring and tracking rules",
      icon: MousePointer,
      color: "emerald",
    },
    {
      id: "screenshots",
      title: "Screenshots",
      description: "Configure screenshot capture settings and frequency",
      icon: Monitor,
      color: "purple",
    },
    {
      id: "urls",
      title: "URLs",
      description: "Manage URL tracking and website monitoring",
      icon: Globe,
      color: "amber",
    },
    {
      id: "apps",
      title: "Apps",
      description: "Configure application usage tracking",
      icon: FileText,
      color: "rose",
    },
  ]
const colorClasses: Record<string, { bg: string; icon: string }> = {
    blue: { bg: "bg-blue-50", icon: "text-blue-600" },
    emerald: { bg: "bg-emerald-50", icon: "text-emerald-600" },
    purple: { bg: "bg-purple-50", icon: "text-purple-600" },
    amber: { bg: "bg-amber-50", icon: "text-amber-600" },
    rose: { bg: "bg-rose-50", icon: "text-rose-600" },
  }

function OverviewSection({ onNavigate }: { onNavigate?: (id: string) => void }) {
  return (
    <div className="space-y-6">
      <div className="mb-6">
        <h2 className="text-lg font-semibold text-slate-800">Activity & Tracking</h2>
        <p className="text-sm text-slate-500">Manage time tracking, activity monitoring, and data capture settings</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {sections.map((section) => {
          const Icon = section.icon
          const colors = colorClasses[section.color]
          return (
            <button
              key={section.id}
              onClick={() => onNavigate?.(`settings-activity-${section.id}`)}
              className="flex items-start gap-4 p-5 bg-white rounded-xl border border-slate-200 shadow-sm hover:border-blue-300 hover:shadow-md transition-all text-left" type="button"
            >
              <div className={cn("w-10 h-10 rounded-lg flex items-center justify-center shrink-0", colors.bg)}>
                <Icon className={cn("w-5 h-5", colors.icon)} />
              </div>
              <div className="flex-1">
                <h3 className="text-sm font-semibold text-slate-800">{section.title}</h3>
                <p className="text-xs text-slate-500 mt-1">{section.description}</p>
              </div>
            </button>
          )
        })}
      </div>
    </div>
  )
}

export function ActivityTrackingSettingsPage({ onNavigate }: ActivityTrackingSettingsProps) {
  const [activeSection, setActiveSection] = useComponentState<Section>("overview")

  return (
    <div className="p-6 max-w-4xl mx-auto">
      {activeSection !== "overview" && (
        <button
          onClick={() => setActiveSection("overview")}
          className="flex items-center gap-2 text-sm text-slate-500 hover:text-slate-700 mb-4" type="button"
        >
          <ArrowLeft className="w-4 h-4" />
          Back to Activity & Tracking
        </button>
      )}

      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.2 }}
      >
        {activeSection === "overview" && <OverviewSection onNavigate={(id) => {
          if (id === "settings-activity-timesheets") {
            setActiveSection("timesheets")
          } else {
            onNavigate?.(id)
          }
        }} />}
        {activeSection === "timesheets" && <TimesheetsSection />}
      </motion.div>
    </div>
  )
}
