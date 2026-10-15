import { clearActivityApiFeedCache } from "@/features/activity/services/activity-api"
import { clearActivityFeedCache } from "@/features/activity/utils/activity-feed-cache"
import { invalidateCommandCenterCache } from "@/features/dashboard/api/command-center-api"
import { invalidateGeneralDashboardCache } from "@/features/dashboard/api/general-dashboard-api"

/**
 * After a screenshot's activity is corrected or an app or site is classified: every page
 * that shows activity or productivity keeps a saved copy for a minute or more (the
 * activity feeds and both dashboards), so drop them all, and tell any open activity page
 * to fetch again. Without this the change appeared to do nothing until the copies aged.
 */
export function refreshAfterActivityChange(): void {
  clearActivityApiFeedCache()
  clearActivityFeedCache()
  invalidateCommandCenterCache()
  invalidateGeneralDashboardCache()
  window.dispatchEvent(new Event("vt-activity-feed-invalidate"))
}
