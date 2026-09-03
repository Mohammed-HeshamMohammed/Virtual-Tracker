"use client"

import { useState } from "react"
import { AnimatePresence, motion } from "framer-motion"
import { Check, ChevronLeft } from "lucide-react"
import { COLUMN_LABEL_KEY_MAP, COLUMN_PICKER_SECTIONS } from "@/features/reports/components/shared/constants"
import { cn } from "@/shared/utils/utils"
import type {
  TimeActivityColumnPickerLeafItem,
  TimeActivityColumnPickerScope,
  TimeActivityColumnPickerSection,
} from "@/features/reports/models/time-and-activity"

function isLeafItem(item: TimeActivityColumnPickerLeafItem | string): item is TimeActivityColumnPickerLeafItem {
  return typeof item === "object" && item !== null && "label" in item
}

export function ReportColumnPicker({
  scope,
  onScopeChange,
  enabledCols,
  onToggle,
}: {
  scope: TimeActivityColumnPickerScope
  onScopeChange: (s: TimeActivityColumnPickerScope) => void
  enabledCols: Set<string>
  onToggle: (k: string) => void
}) {
  const [flyout, setFlyout] = useState<string | null>(null)

  function getKey(label: string): string {
    return COLUMN_LABEL_KEY_MAP[label] ?? label.toLowerCase().replace(/\s+/g, "_")
  }

  function renderFlatSection(section: TimeActivityColumnPickerSection) {
    const items = section.items
    if (!items) return null
    return items.map((item) => {
      if (isLeafItem(item) || (typeof item === "object" && item !== null && "key" in item)) {
        const leaf = item as TimeActivityColumnPickerLeafItem
        const k = leaf.key ?? getKey(leaf.label ?? "")
        const lbl = leaf.label ?? String(leaf.key ?? "")
        return (
          <button
            key={k}
            onClick={() => onToggle(k)}
            className="flex w-full items-center justify-between px-4 py-2.5 text-sm text-slate-700 dark:text-slate-200 transition-colors hover:bg-slate-50 dark:hover:bg-slate-800" type="button"
          >
            {lbl}
            {enabledCols.has(k) && <Check className="h-4 w-4 text-slate-500 dark:text-slate-400" />}
          </button>
        )
      }
      const label = String(item)
      const k = getKey(label)
      return (
        <button
          key={k}
          onClick={() => onToggle(k)}
          className="flex w-full items-center justify-between px-4 py-2.5 text-sm text-slate-700 dark:text-slate-200 transition-colors hover:bg-slate-50 dark:hover:bg-slate-800" type="button"
        >
          {label}
          {enabledCols.has(k) && <Check className="h-4 w-4 text-slate-500 dark:text-slate-400" />}
        </button>
      )
    })
  }

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.95, y: -4 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.95, y: -4 }}
      transition={{ duration: 0.14 }}
      className="absolute right-0 top-10 z-30 max-h-[520px] w-64 overflow-hidden rounded-xl border border-slate-100 dark:border-slate-700 bg-white dark:bg-slate-900 shadow-xl"
    >
      <div className="flex gap-1 border-b border-slate-100 dark:border-slate-800 p-1.5">
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation()
            onScopeChange("period")
          }}
          className={cn(
            "flex-1 rounded-lg py-2 text-xs font-semibold transition-colors",
            scope === "period" ? "bg-blue-50 dark:bg-blue-950/60 text-blue-600 dark:text-blue-400" : "text-slate-500 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-800"
          )}
        >
          Period
        </button>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation()
            onScopeChange("member")
          }}
          className={cn(
            "flex-1 rounded-lg py-2 text-xs font-semibold transition-colors",
            scope === "member" ? "bg-blue-50 dark:bg-blue-950/60 text-blue-600 dark:text-blue-400" : "text-slate-500 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-800"
          )}
        >
          Member rows
        </button>
      </div>
      <div className="max-h-[440px] overflow-y-auto custom-scrollbar py-1">
        {COLUMN_PICKER_SECTIONS.map((section, si) => (
          <div key={si}>
            {section.group && (
              <div
                className="relative"
                onMouseEnter={() => section.expandable && setFlyout(section.group!)}
                onMouseLeave={() => setFlyout(null)}
              >
                <button className="flex w-full items-center gap-2 px-4 py-2.5 text-sm text-slate-700 dark:text-slate-200 transition-colors hover:bg-slate-50 dark:hover:bg-slate-800" type="button">
                  <ChevronLeft className="h-3.5 w-3.5 text-slate-400 dark:text-slate-500" />
                  {section.group}
                </button>
                <AnimatePresence>
                  {flyout === section.group && section.subItems && (
                    <motion.div
                      initial={{ opacity: 0, x: 4 }}
                      animate={{ opacity: 1, x: 0 }}
                      exit={{ opacity: 0 }}
                      transition={{ duration: 0.1 }}
                      className="absolute right-full top-0 z-40 mr-1 max-h-80 w-64 overflow-y-auto custom-scrollbar rounded-xl border border-slate-100 dark:border-slate-700 bg-white dark:bg-slate-900 py-1 shadow-xl"
                      onMouseEnter={() => setFlyout(section.group!)}
                      onMouseLeave={() => setFlyout(null)}
                    >
                      <div className="flex items-center gap-2 border-b border-slate-50 dark:border-slate-800 px-4 py-2.5">
                        <ChevronLeft className="h-4 w-4 text-slate-500 dark:text-slate-400" />
                        <span className="text-sm font-semibold text-slate-700 dark:text-slate-200">{section.group}</span>
                      </div>
                      {section.subItems.map((sub, subi) => (
                        <div key={subi}>
                          {sub.sub && (
                            <div className="px-4 pb-1 pt-2 text-xs font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500">
                              {sub.sub}
                            </div>
                          )}
                          {sub.items.map((item) => {
                            const k = getKey(item)
                            return (
                              <button
                                key={item}
                                onClick={() => onToggle(k)}
                                className="flex w-full items-center justify-between px-4 py-2.5 text-sm text-slate-700 dark:text-slate-200 transition-colors hover:bg-slate-50 dark:hover:bg-slate-800" type="button"
                              >
                                {item}
                                {enabledCols.has(k) && <Check className="h-4 w-4 text-slate-500 dark:text-slate-400" />}
                              </button>
                            )
                          })}
                        </div>
                      ))}
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            )}
            {!section.group && renderFlatSection(section)}
          </div>
        ))}
      </div>
    </motion.div>
  )
}

