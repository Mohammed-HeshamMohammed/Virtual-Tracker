export type StatStackBlock = {
  kind: "stack"
  id: string
  widgetIds: string[]
}

export type PanelBlock = {
  kind: "panel"
  id: string
  widgetId: string
}

export type LayoutBlock = StatStackBlock | PanelBlock
