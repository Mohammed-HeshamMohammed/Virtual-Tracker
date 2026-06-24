"use client"

import { useState } from "react"
import { MoreHorizontal, Pencil, Trash2 } from "lucide-react"
import { cn } from "@/shared/utils/utils"
import {
  TABLE_ROW_MENU_ITEM_BASE,
  tableRowMenuContentClass,
  tableRowMenuItemClass,
} from "@/shared/ui/layout/table-row-menu-styles"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/shared/ui/dropdown-menu"

interface TeamRowMenuProps {
  onEdit: () => void
  onDelete: () => void
  isDark?: boolean
}

export function TeamRowMenu({ onEdit, onDelete, isDark = false }: TeamRowMenuProps) {
  const [open, setOpen] = useState(false)

  const items = [
    { label: "Edit team", icon: <Pencil className="w-3.5 h-3.5" />, action: onEdit },
    { label: "Delete team", icon: <Trash2 className="w-3.5 h-3.5" />, action: onDelete, danger: true },
  ]

  return (
    <div className="relative">
      <DropdownMenu open={open} onOpenChange={setOpen}>
        <DropdownMenuTrigger asChild>
          <button
            onClick={(e) => {
              e.stopPropagation()
            }}
            className={cn(
              "rounded-lg p-1.5 transition-colors opacity-70 hover:opacity-100 group-hover:opacity-100 data-[state=open]:opacity-100",
              isDark ? "hover:bg-[#191f31]" : "hover:bg-slate-100",
            )} type="button"
          >
            <MoreHorizontal className={cn("w-4 h-4", isDark ? "text-[#bccbb9]" : "text-slate-400")} />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className={tableRowMenuContentClass(isDark)}>
          {items.map((item) => (
            <DropdownMenuItem
              key={item.label}
              onClick={(e) => {
                e.stopPropagation()
                item.action()
                setOpen(false)
              }}
              className={cn(TABLE_ROW_MENU_ITEM_BASE, tableRowMenuItemClass(item.danger, isDark))}
            >
              {item.icon}
              {item.label}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}
