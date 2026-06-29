import { Sun, Moon, Monitor, User, LogOut, RefreshCw } from "lucide-react"

// ==========================================
// 1. People / Projects Theme Constants
// ==========================================

export const PEOPLE_THEME_DARK = {
  pageBg:           "bg-[#0c1324]",
  bannerBg:         "bg-gradient-to-r from-[#1a2235] to-[#151b2d]",
  bannerBorder:     "border-[#3d4a3d]/40",
  bannerText:       "text-[#dce1fb]",
  bannerSubtext:    "text-[#bccbb9]",
  bannerLink:       "text-[#4be277] hover:text-[#6bf397]",
  bannerBtn:        "bg-[#4be277] text-[#0c1324] hover:bg-[#6bf397]",
  bannerClose:      "text-[#bccbb9] hover:text-[#dce1fb]",

  tabActive:        "bg-[#4be277] text-[#0c1324]",
  tabInactive:      "bg-[#191f31] text-[#bccbb9] hover:bg-[#2e3447] hover:text-[#dce1fb]",
  tabBadge:         "bg-[#0c1324]/20",

  searchWrap:       "bg-[#191f31] border-[#3d4a3d]/40",
  searchIcon:       "text-[#bccbb9]",
  searchInput:      "text-[#dce1fb] placeholder:text-[#bccbb9]/50",

  btnSecondary:     "text-[#bccbb9] hover:text-[#dce1fb] hover:bg-[#191f31]/60",
  btnPrimary:       "bg-[#4be277] text-[#0c1324] hover:bg-[#6bf397]",
  btnGhost:         "text-[#bccbb9] hover:text-[#dce1fb]",

  divider:          "bg-[#3d4a3d]/40",

  tableBg:          "bg-[#151b2d]",
  tableBorder:      "border-[#3d4a3d]/40",
  tableHeader:      "bg-[#191f31] text-[#bccbb9]",
  tableRowHover:    "hover:bg-[#191f31]/60",
  tableCell:        "text-[#dce1fb]",
  tableCellMuted:   "text-[#bccbb9]",

  dropdown:         "bg-[#191f31] border-[#3d4a3d]/40 shadow-xl",
  dropdownHeader:   "text-[#bccbb9]/60",
  dropdownItem:     "text-[#dce1fb] hover:bg-[#2e3447]",
  dropdownItemActive: "text-[#4be277]",

  emptyStateBg:     "bg-[#191f31]",
  emptyStateIcon:   "text-[#3d4a3d]",
  emptyStateText:   "text-[#bccbb9]",
  emptyStateLink:   "text-[#4be277] hover:text-[#6bf397]",

  modalOverlay:     "bg-[#0c1324]/80",
  modalBg:          "bg-[#191f31]",
  modalBorder:      "border-[#3d4a3d]/40",
  modalHeader:      "text-[#dce1fb]",
  modalText:        "text-[#bccbb9]",
  modalInput:       "bg-[#151b2d] border-[#3d4a3d]/40 text-[#dce1fb] placeholder:text-[#bccbb9]/50",
  modalInputFocus:  "focus:border-[#4be277] focus:ring-1 focus:ring-[#4be277]/20",

  chip:             "bg-[#2e3447] text-[#dce1fb]",
  chipMore:         "bg-[#2e3447] text-[#bccbb9]",

  menuBg:           "bg-[#191f31] border-[#3d4a3d]/40",
  menuItem:         "text-[#dce1fb] hover:bg-[#2e3447]",
  menuItemDanger:   "text-red-400 hover:bg-red-400/10",

  purpleIconBg:     "bg-purple-500/20",
  purpleIcon:       "text-purple-400",
  blueIconBg:       "bg-blue-500/20",
  blueIcon:         "text-blue-400",
}

export const PEOPLE_THEME_LIGHT = {
  pageBg:           "bg-white",
  bannerBg:         "bg-gradient-to-r from-blue-50 to-white",
  bannerBorder:     "border-slate-100",
  bannerText:       "text-slate-700",
  bannerSubtext:    "text-slate-600",
  bannerLink:       "text-blue-600 hover:text-blue-700",
  bannerBtn:        "bg-blue-600 text-white hover:bg-blue-700",
  bannerClose:      "text-slate-400 hover:text-slate-600",

  tabActive:        "bg-blue-500 text-white",
  tabInactive:      "bg-slate-100 text-slate-700 hover:bg-slate-200",
  tabBadge:         "bg-white/20",

  searchWrap:       "bg-white border-slate-200",
  searchIcon:       "text-slate-400",
  searchInput:      "text-slate-700 placeholder:text-slate-400",

  btnSecondary:     "text-slate-600 hover:text-slate-800",
  btnPrimary:       "bg-blue-500 text-white hover:bg-blue-600",
  btnGhost:         "text-slate-600 hover:text-slate-800",

  divider:          "bg-slate-200",

  tableBg:          "bg-white",
  tableBorder:      "border-slate-200",
  tableHeader:      "bg-slate-50 text-slate-500",
  tableRowHover:    "hover:bg-slate-50",
  tableCell:        "text-slate-700",
  tableCellMuted:   "text-slate-400",

  dropdown:         "bg-white border-slate-100 shadow-xl",
  dropdownHeader:   "text-slate-400",
  dropdownItem:     "text-slate-800 hover:bg-slate-50",
  dropdownItemActive: "text-blue-500",

  emptyStateBg:     "bg-slate-100",
  emptyStateIcon:   "text-slate-300",
  emptyStateText:   "text-slate-500",
  emptyStateLink:   "text-blue-500 hover:text-blue-600",

  modalOverlay:     "bg-black/50",
  modalBg:          "bg-white",
  modalBorder:      "border-slate-100",
  modalHeader:      "text-slate-800",
  modalText:        "text-slate-600",
  modalInput:       "bg-white border-slate-200 text-slate-700 placeholder:text-slate-400",
  modalInputFocus:  "focus:border-blue-400 focus:ring-1 focus:ring-blue-400",

  chip:             "bg-slate-100 text-slate-600",
  chipMore:         "bg-slate-100 text-slate-500",

  menuBg:           "bg-white border-slate-100",
  menuItem:         "text-slate-700 hover:bg-slate-50",
  menuItemDanger:   "text-red-500 hover:bg-red-50",

  purpleIconBg:     "bg-purple-100",
  purpleIcon:       "text-purple-500",
  blueIconBg:       "bg-blue-100",
  blueIcon:         "text-blue-500",
}

export type PeopleThemeColors = typeof PEOPLE_THEME_DARK | typeof PEOPLE_THEME_LIGHT

// ==========================================
// 2. Sidebar Constants & Theme
// ==========================================

export const THEME_OPTIONS = [
  { label: "Light",  value: "light",  icon: Sun     },
  { label: "Dark",   value: "dark",   icon: Moon    },
  { label: "System", value: "system", icon: Monitor },
] as const

export type Theme = "light" | "dark" | "system"

export const USER_MENU = [
  { label: "Profile",     icon: User,      action: "profile",  danger: false },
  { label: "Settings",    icon: User,      action: "settings", danger: false },
  { label: "Switch user", icon: RefreshCw, action: "switch",   danger: false },
  { label: "Log out",     icon: LogOut,    action: "logout",   danger: true  },
] as const

export type UserMenuAction = "profile" | "settings" | "switch" | "logout"

export const SIDEBAR_THEME_DARK = {
  aside:        "bg-[#151b2d]",
  text:         "text-[#dce1fb]",
  textMuted:    "text-[#bccbb9]",
  hover:         "hover:bg-[#191f31]/60 hover:text-[#dce1fb]",
  active:        "bg-[#191f31] text-[#dce1fb]",
  border:        "border-white/10",
  logoBg:        "bg-white/10",
  scrollTrack:  "#1a2235",
  scrollThumb:  "#3d4a3d",
  iconActive:   "text-[#4be277]",
  iconDefault:  "text-[#bccbb9]",
  itemActive:   "bg-[#191f31] text-[#4be277] font-semibold",
  itemHover:    "hover:bg-[#191f31]/60 hover:text-[#dce1fb]",
  itemInactive: "text-[#bccbb9]",
  bar:          "bg-[#4be277]",
  userCard:     "bg-[#191f31]/60",
  userMenu:     "bg-[#191f31] border border-[#3d4a3d]/40 shadow-[0_8px_40px_0_rgba(75,226,119,0.06)]",
  userMenuHead: "border-b border-[#3d4a3d]/40 bg-[#151b2d]/60",
  userMenuFoot: "border-t border-[#3d4a3d]/40 bg-[#151b2d]/40",
  sep:          "bg-[#3d4a3d]/70",
  contextMenu:  "bg-[#191f31] border-[#3d4a3d]/40",
  contextItem:  "text-[#dce1fb] hover:bg-[#2e3447]",
  addTaskFrom:  "#4be277",
  addTaskTo:    "#22c55e",
  addTaskText:  "text-[#0c1324]",
  themeActive:  "bg-[#4be277] text-[#0c1324]",
  themeInactive:"bg-[#2e3447] text-[#bccbb9] hover:bg-[#3d4a3d]/60",
  logoTitle:    "text-[#dce1fb]",
  logoSub:      "text-[#bccbb9]",
  collapseBtn:  "hover:bg-[#191f31]/80",
  hiddenBorder: "border-[#3d4a3d]/50",
}

export const SIDEBAR_THEME_LIGHT = {
  aside:        "bg-[#f0f4f8]",
  text:         "text-[#171c1f]",
  textMuted:    "text-[#171c1f]/60",
  hover:         "hover:bg-[#e4e9ed] hover:text-[#171c1f]",
  active:        "bg-[#e4e9ed] text-[#171c1f]",
  border:        "border-slate-200",
  logoBg:        "bg-slate-200",
  scrollTrack:  "#f1f5f9",
  scrollThumb:  "#cbd5e1",
  iconActive:   "text-[#6b38d4]",
  iconDefault:  "text-[#171c1f]/60",
  itemActive:   "bg-[#e4e9ed] text-[#6b38d4] font-semibold",
  itemHover:    "hover:bg-[#e4e9ed] hover:text-[#171c1f]",
  itemInactive: "text-[#171c1f]/60",
  bar:          "bg-[#6b38d4]",
  userCard:     "bg-[#f6fafe]",
  userMenu:     "bg-[#f6fafe] shadow-xl",
  userMenuHead: "border-b border-[#e4e9ed] bg-[#f6fafe]",
  userMenuFoot: "border-t border-[#e4e9ed] bg-[#f6fafe]",
  sep:          "bg-[#e4e9ed]",
  contextMenu:  "bg-[#f6fafe] shadow-xl",
  contextItem:  "text-[#171c1f] hover:bg-[#e4e9ed]",
  addTaskFrom:  "#6b38d4",
  addTaskTo:    "#8b5cf6",
  addTaskText:  "text-white",
  themeActive:  "bg-[#6b38d4] text-white",
  themeInactive:"bg-[#f6fafe] text-[#171c1f] hover:bg-[#e4e9ed]",
  logoTitle:    "text-[#171c1f]",
  logoSub:      "text-[#171c1f]/60",
  collapseBtn:  "hover:bg-[#e4e9ed]",
  hiddenBorder: "border-[#e4e9ed]",
}

export type ThemeColors = typeof SIDEBAR_THEME_DARK | typeof SIDEBAR_THEME_LIGHT

// ==========================================
// 3. Topbar Theme Constants
// ==========================================

export const TOPBAR_THEME_DARK = {
  header:        "bg-[#151b2d]",
  breadcrumbBtn: "text-[#bccbb9] hover:bg-[#191f31]/60 hover:text-[#dce1fb]",
  breadcrumbSep: "text-[#3d4a3d]",
  pageBtn:       "text-[#dce1fb] hover:bg-[#191f31]/60",
  pageBtnOpen:   "text-[#dce1fb] bg-[#191f31]/60",
  chevron:       "text-[#bccbb9]",
  searchWrap:    "bg-[#191f31] shadow-none focus-within:ring-2 focus-within:ring-[#4be277]/20",
  searchBg:      "bg-[#1a2235] border-white/10 text-white placeholder:text-white/20",
  searchIcon:    "text-white/40",
  searchInput:   "text-[#dce1fb] placeholder:text-[#bccbb9]",
  iconBtn:       "text-[#bccbb9] hover:text-[#4be277] hover:bg-[#191f31]/60",
  userBtn:       "text-white/60 hover:bg-white/5 hover:text-white",
  popupBg:       "bg-[#1a2235] border-white/10",
  popupHeader:   "bg-[#151b2d] border-white/5",
  popupItem:     "text-white/70 hover:bg-white/5 hover:text-white",
  popupClose:    "bg-[#2e3447] hover:bg-[#3d4a3d]",
  divider:       "border-[#3d4a3d]/40",
  dropdown:      "bg-[#191f31] shadow-xl",
  dropHead:      "border-b border-[#3d4a3d]/40 bg-[#151b2d]/60",
  dropHeadLabel: "text-[#bccbb9]/60",
  dropItem:      "text-[#dce1fb]/80 hover:bg-[#2e3447] font-medium",
  dropItemActive:"text-[#4be277] font-semibold bg-[#191f31]",
  dropSep:       "bg-[#3d4a3d]/40",
  dropOtherLabel:"text-[#bccbb9]/60",
  dropOtherBtn:  "text-[#bccbb9]/60 hover:text-[#dce1fb] hover:bg-[#191f31]/60",
  notifHead:     "border-b border-[#3d4a3d]/40 bg-[#151b2d]/60",
  notifTitle:    "text-[#dce1fb]",
  notifDivide:   "divide-[#3d4a3d]/40",
  notifItemHover:"hover:bg-[#2e3447]",
  notifItemTitle:"text-[#dce1fb]",
  notifItemBody: "text-[#bccbb9]/60",
  notifItemTime: "text-[#bccbb9]/40",
  notifFoot:     "bg-[#151b2d]/40 border-t border-[#3d4a3d]/40",
  timerTooltip:  "bg-[#171c1f] text-white",
  timerArrow:    "border-t-[#171c1f]",
  popupWrap:     "bg-[#191f31] shadow-xl",
  popupSep:      "border-r border-[#3d4a3d]/40",
  popupTaskLabel:"text-[#bccbb9]/60",
  popupTaskName: "text-[#dce1fb]",
  popupTime:     "text-[#dce1fb]",
}

export const TOPBAR_THEME_LIGHT = {
  header:        "bg-[#f0f4f8]",
  breadcrumbBtn: "text-[#171c1f]/60 hover:bg-[#e4e9ed] hover:text-[#171c1f]",
  breadcrumbSep: "text-[#171c1f]/40",
  pageBtn:       "text-[#171c1f] hover:bg-[#e4e9ed]",
  pageBtnOpen:   "text-[#171c1f] bg-[#e4e9ed]",
  chevron:       "text-[#171c1f]/40",
  searchWrap:    "bg-white border-slate-200 shadow-sm focus-within:ring-2 focus-within:ring-[#6b38d4]/20",
  searchBg:      "bg-white border-slate-200 text-slate-700 placeholder:text-slate-300",
  searchIcon:    "text-slate-400",
  searchInput:   "text-slate-700 placeholder:text-slate-300",
  iconBtn:       "text-slate-600 hover:text-[#6b38d4] hover:bg-slate-100",
  userBtn:       "text-slate-600 hover:bg-slate-100 hover:text-slate-700",
  popupBg:       "bg-white border-slate-200",
  popupHeader:   "bg-slate-50 border-slate-100",
  popupItem:     "text-slate-700 hover:bg-slate-50",
  popupClose:    "bg-slate-100 hover:bg-slate-200",
  divider:       "border-slate-200",
  dropdown:      "bg-[#f6fafe] shadow-xl",
  dropHead:      "border-b border-[#e4e9ed] bg-[#f6fafe]",
  dropHeadLabel: "text-[#171c1f]/60",
  dropItem:      "text-[#171c1f]/80 hover:bg-[#e4e9ed] font-medium",
  dropItemActive:"text-[#6b38d4] font-semibold bg-[#e4e9ed]",
  dropSep:       "bg-[#e4e9ed]",
  dropOtherLabel:"text-[#171c1f]/60",
  dropOtherBtn:  "text-[#171c1f]/60 hover:text-[#171c1f] hover:bg-[#e4e9ed]",
  notifHead:     "border-b border-[#e4e9ed] bg-[#f6fafe]",
  notifTitle:    "text-[#171c1f]",
  notifDivide:   "divide-[#e4e9ed]",
  notifItemHover:"hover:bg-[#e4e9ed]",
  notifItemTitle:"text-[#171c1f]",
  notifItemBody: "text-[#171c1f]/60",
  notifItemTime: "text-[#171c1f]/40",
  notifFoot:     "bg-[#f6fafe] border-t border-[#e4e9ed]",
  timerTooltip:  "bg-[#171c1f] text-white",
  timerArrow:    "border-t-[#171c1f]",
  popupWrap:     "bg-[#f6fafe] shadow-xl",
  popupSep:      "border-r border-[#e4e9ed]",
  popupTaskLabel:"text-[#171c1f]/60",
  popupTaskName: "text-[#171c1f]",
  popupTime:     "text-[#171c1f]",
}

export type TopbarThemeColors = typeof TOPBAR_THEME_DARK | typeof TOPBAR_THEME_LIGHT
