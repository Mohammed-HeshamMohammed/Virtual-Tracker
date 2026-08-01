"use client"

import { useState } from "react"
import { Check, ChevronDown } from "lucide-react"
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/shared/ui/command"
import { Popover, PopoverContent, PopoverTrigger } from "@/shared/ui/popover"
import { cn } from "@/shared/utils/utils"

export function ReportCombobox({
  value,
  onChange,
  options,
  placeholder = "Select…",
  emptyText = "No results.",
  id,
  className,
  "aria-label": ariaLabel,
}: {
  value: string
  onChange: (next: string) => void
  options: readonly string[]
  placeholder?: string
  emptyText?: string
  id?: string
  className?: string
  "aria-label"?: string
}) {
  const [open, setOpen] = useState(false)

  const listboxId = id ? `${id}-list` : "report-combobox-list"

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          id={id}
          role="combobox"
          aria-expanded={open}
          aria-controls={open ? listboxId : undefined}
          aria-label={ariaLabel}
          className={cn(
            "flex h-9 w-full items-center justify-between gap-2 rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 text-left text-sm text-slate-800 dark:text-slate-200 shadow-xs outline-none transition-[box-shadow,border-color]",
            "hover:border-slate-300 dark:hover:border-slate-600 focus-visible:border-blue-500 dark:focus-visible:border-blue-400 focus-visible:ring-2 focus-visible:ring-blue-500/30",
            open && "border-blue-500 dark:border-blue-400 ring-2 ring-blue-500/30",
            className
          )}
        >
          <span className={cn("truncate", !value && "text-slate-400 dark:text-slate-500")}>{value || placeholder}</span>
          <ChevronDown
            className={cn("h-4 w-4 shrink-0 text-slate-500 dark:text-slate-400 transition-transform duration-200", open && "rotate-180")}
          />
        </button>
      </PopoverTrigger>
      <PopoverContent
        className="z-100 w-(--radix-popover-trigger-width) p-0"
        align="start"
        sideOffset={4}
      >
        <Command>
          <CommandInput placeholder="Search…" className="h-9 border-slate-100 dark:border-slate-800" />
          <CommandList id={listboxId} className="max-h-[240px] scrollbar-hide">
            <CommandEmpty>{emptyText}</CommandEmpty>
            <CommandGroup>
              {options.map((opt) => (
                <CommandItem
                  key={opt}
                  value={opt}
                  onSelect={() => {
                    onChange(opt)
                    setOpen(false)
                  }}
                  className={cn(
                    "cursor-pointer",
                    value === opt &&
                      "bg-blue-500 dark:bg-blue-600 text-white data-[selected=true]:bg-blue-500 dark:data-[selected=true]:bg-blue-600 data-[selected=true]:text-white"
                  )}
                >
                  {opt}
                  {value === opt ? <Check className="ml-auto h-4 w-4 shrink-0" /> : null}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}

