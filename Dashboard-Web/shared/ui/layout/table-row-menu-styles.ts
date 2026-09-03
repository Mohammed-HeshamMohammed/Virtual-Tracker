import { cn } from "@/shared/utils/utils"

export function tableRowMenuContentClass(isDark: boolean, widthClass = "w-40"): string {
  return cn(
    "rounded-xl border p-1 shadow-lg",
    widthClass,
    isDark ? "border-[#3d4a3d]/40 bg-[#191f31]" : "border-slate-100 bg-white",
  )
}

export const TABLE_ROW_MENU_ITEM_BASE =
  "flex cursor-pointer items-center gap-2.5 rounded-md px-2.5 py-2 text-xs outline-none transition-colors"

export function tableRowMenuItemClass(danger: boolean | undefined, isDark: boolean): string {
  if (danger) {
    return isDark
      ? "text-red-400 hover:bg-red-400/10 focus:bg-red-400/10 focus:text-red-400 data-[highlighted]:bg-red-400/10 data-[highlighted]:text-red-400"
      : "text-red-500 hover:bg-red-50 focus:bg-red-50 focus:text-red-500 data-[highlighted]:bg-red-50 data-[highlighted]:text-red-500"
  }
  return isDark
    ? "text-[#dce1fb] hover:bg-[#2e3447] focus:bg-[#2e3447] focus:text-[#dce1fb] data-[highlighted]:bg-[#2e3447] data-[highlighted]:text-[#dce1fb]"
    : "text-slate-600 hover:bg-slate-50 focus:bg-slate-50 focus:text-slate-600 data-[highlighted]:bg-slate-50 data-[highlighted]:text-slate-600"
}
