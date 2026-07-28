"use client"

import { Monitor } from "lucide-react"

interface ActivityEmptyStateProps {
  title: string
  description: string
  showAgentHint?: boolean
}

export function ActivityEmptyState({ title, description, showAgentHint = true }: ActivityEmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900/60 px-8 py-16 text-center">
      <Monitor className="mb-4 h-12 w-12 text-slate-300 dark:text-slate-700" />
      <h3 className="text-lg font-semibold text-slate-700 dark:text-slate-200">{title}</h3>
      <p className="mt-2 max-w-md text-sm text-slate-500 dark:text-slate-400">{description}</p>
      {showAgentHint ? (
        <div className="mt-6 space-y-2 text-sm text-slate-600 dark:text-slate-300">
          <p>1. Run <strong>Python-App-Extension\run.bat</strong> and sign in when prompted</p>
          <p>2. Select a task in the sidebar, then click <strong>Start timer</strong></p>
          <p>3. The agent captures your screen, apps, and browser URLs while the timer is active</p>
        </div>
      ) : null}
    </div>
  )
}
