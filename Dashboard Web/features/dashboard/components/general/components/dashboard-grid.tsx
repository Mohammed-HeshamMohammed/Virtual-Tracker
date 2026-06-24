"use client"

import { DASHBOARD_STAT_SLOT_PX } from "@/features/dashboard/components/general/constants"
import type { LayoutBlock } from "@/features/dashboard/components/general/lib/layout-engine"
import { PanelBlock, StatStack, StatSlot } from "@/features/dashboard/components/general/components/stat-stack"
import { DashboardWidget } from "@/features/dashboard/components/general/widgets"
import { WidgetErrorBoundary } from "@/shared/ui/widget-error-boundary"
import { useTheme } from "@/shared/providers/app"

export function DashboardGrid({
  blocks,
  onNavigate,
}: {
  blocks: LayoutBlock[]
  onNavigate?: (id: string) => void
}) {
  const { isDark } = useTheme()

  return (
    <div
      className="grid grid-cols-12 items-stretch gap-5"
      style={{ gridAutoRows: `${DASHBOARD_STAT_SLOT_PX}px` }}
    >
      {blocks.map((block) => {
        if (block.kind === "panel") {
          return (
            <PanelBlock key={block.id}>
              <WidgetErrorBoundary label={block.widgetId} isDark={isDark}>
                <DashboardWidget id={block.widgetId} onNavigate={onNavigate} />
              </WidgetErrorBoundary>
            </PanelBlock>
          )
        }

        return (
          <StatStack key={block.id}>
            {block.widgetIds.map((widgetId) => (
              <StatSlot key={widgetId} stackSize={block.widgetIds.length}>
                <WidgetErrorBoundary label={widgetId} isDark={isDark}>
                  <DashboardWidget id={widgetId} onNavigate={onNavigate} />
                </WidgetErrorBoundary>
              </StatSlot>
            ))}
          </StatStack>
        )
      })}
    </div>
  )
}
