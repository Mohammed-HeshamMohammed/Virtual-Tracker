// App shell — sidebar, topbar, nav, search, toasts.

export { Sidebar } from "@/shared/ui/layout/components/sidebar/sidebar"
export { Topbar } from "@/shared/ui/layout/components/topbar/topbar"
export {
  NAV_SECTIONS,
  getSectionForPage,
  getPageLabel,
  getSubsectionForPage,
  PAGE_PARENTS,
  sortedItems,
  type NavSection,
  type NavSubItem,
  type NavSubSection,
} from "@/shared/ui/layout/config/nav-sections"
export { PageSearchProvider, usePageSearch } from "@/shared/ui/layout/context/page-search-context"
export { GlobalSearchBar } from "@/shared/ui/layout/components/topbar/global-search-bar"
export { AuthErrorToastHost, type AuthErrorToastHostProps } from "@/shared/ui/layout/toasts/auth-error-toast-host"
export { NotifyToastHost, type NotifyToastHostProps } from "@/shared/ui/layout/toasts/notify-toast-host"
