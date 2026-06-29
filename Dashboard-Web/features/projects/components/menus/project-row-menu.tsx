"use client"

import { useState } from "react"
import { Archive, MoreHorizontal, Pencil, Trash2 } from "lucide-react"
import { cn } from "@/shared/utils/utils"
import {
  TABLE_ROW_MENU_ITEM_BASE,
  tableRowMenuContentClass,
  tableRowMenuItemClass,
} from "@/shared/ui/layout/table-row-menu-styles"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/shared/ui/dropdown-menu"
import type { ProjectListItem } from "@/features/projects/models/list"

export function ProjectRowMenu({
  project,
  onEdit,
  onArchive,
  onDelete,
  isDark = false,
}: {
  project: ProjectListItem
  onEdit: () => void
  onArchive: () => void
  onDelete: () => void
  isDark?: boolean
}) {
  const [open, setOpen] = useState(false)
  const items = [
    { icon: <Pencil className="h-3.5 w-3.5" />, label: "Edit", action: () => { onEdit(); setOpen(false) } },
    {
      icon: <Archive className="h-3.5 w-3.5" />,
      label: project.status === "active" ? "Archive" : "Unarchive",
      action: () => { onArchive(); setOpen(false) },
    },
    { icon: <Trash2 className="h-3.5 w-3.5" />, label: "Delete", action: () => { onDelete(); setOpen(false) }, danger: true },
  ]
  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          onClick={(e) => e.stopPropagation()}
          className={cn(
            "rounded-lg p-1.5 opacity-0 transition-all group-hover:opacity-100 data-[state=open]:opacity-100",
            isDark ? "hover:bg-[#2e3447]" : "hover:bg-slate-100",
          )}
        >
          <MoreHorizontal className={cn("h-4 w-4", isDark ? "text-[#bccbb9]" : "text-slate-400")} />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className={tableRowMenuContentClass(isDark)}>
        {items.map((item) => (
          <DropdownMenuItem
            key={item.label}
            onClick={(e) => {
              e.stopPropagation()
              item.action()
            }}
            className={cn(TABLE_ROW_MENU_ITEM_BASE, tableRowMenuItemClass(item.danger, isDark))}
          >
            {item.icon}
            {item.label}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
