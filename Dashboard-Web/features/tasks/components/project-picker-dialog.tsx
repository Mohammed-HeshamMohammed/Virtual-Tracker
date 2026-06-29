"use client"

import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/shared/ui/dialog"
import { cn } from "@/shared/utils/utils"

interface ProjectPickerDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  isDark: boolean
  projectList: any[]
  selectedProjectId: string
  setSelectedProjectId: (id: string) => void
  onConfirm: () => void
}

export function ProjectPickerDialog({
  open,
  onOpenChange,
  isDark,
  projectList,
  selectedProjectId,
  setSelectedProjectId,
  onConfirm,
}: ProjectPickerDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className={cn("w-[92vw] max-w-md gap-0 p-6", isDark ? "bg-[#151b2d] border-[#2e3447] text-[#dce1fb]" : "")}>
        <DialogHeader className="pb-4">
          <DialogTitle className="text-lg font-semibold">Select a project</DialogTitle>
          <p className={cn("text-sm", isDark ? "text-[#bccbb9]" : "text-slate-500")}>
            Choose the project this task belongs to.
          </p>
        </DialogHeader>
        <div className="space-y-2 max-h-80 overflow-y-auto pr-1">
          {projectList.length === 0 ? (
            <p className={cn("text-sm py-4 text-center", isDark ? "text-[#bccbb9]" : "text-slate-500")}>
              No projects available.
            </p>
          ) : (
            projectList.map((p: any) => (
              <button
                key={p.id}
                type="button"
                onClick={() => {
                  setSelectedProjectId(p.id)
                  onOpenChange(false)
                  onConfirm()
                }}
                className={cn(
                  "flex w-full items-center gap-3 rounded-xl border px-4 py-3 text-left text-sm font-medium transition-colors",
                  selectedProjectId === p.id
                    ? isDark
                      ? "border-[#4be277]/40 bg-[#4be277]/10 text-[#4be277]"
                      : "border-blue-300 bg-blue-50 text-blue-700"
                    : isDark
                      ? "border-[#2e3447] hover:bg-[#2e3447]"
                      : "border-slate-200 hover:bg-slate-50",
                )}
              >
                <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: p.color }} />
                <span className="flex-1 truncate">{p.name}</span>
              </button>
            ))
          )}
        </div>
        <DialogFooter className="pt-4">
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            className={cn("rounded-lg px-5 py-2 text-sm font-medium transition-colors border", isDark ? "border-[#2e3447] hover:bg-[#2e3447] text-white" : "border-slate-200 hover:bg-slate-50")}
          >
            Cancel
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
