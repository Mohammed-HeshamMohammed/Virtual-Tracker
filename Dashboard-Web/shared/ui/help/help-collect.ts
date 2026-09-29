// Finds what the guided tour should visit on the current screen and what to say at each stop.
// Imports only its neighbours, by relative path, so it is tested against a real DOM from Node.

import { describeControl, type ControlInfo } from "./describe-control.ts"
import { isHiddenFromTour, isShowable, orderForTour, rankOf, type Candidate } from "./help-tour.ts"

/** Anything that carries its own explanation. */
const EXPLAINABLE = "[data-help], [data-tip], [title]"
/** Anything a page is built from that can explain itself from its own wording. */
const READABLE =
  'table, [role="tablist"], input, select, textarea, button, a[href], [role="switch"], [role="combobox"], [role="button"]'
/** The tour's own controls, and the button that starts it, are never steps. */
const OWN_UI = ".help-tour, [data-help-toggle]"
/** A page can be huge; a tour that never ends is worse than one that stops. */
export const MAX_STEPS = 80

export type Step = { el: Element; text: string }

const clean = (text: string | null | undefined) => (text ?? "").replace(/\s+/g, " ").trim()

function nameOf(el: Element): string {
  const own = clean(el.getAttribute("aria-label"))
  if (own) return own
  const by = clean(el.getAttribute("aria-labelledby"))
  if (by) {
    const text = by
      .split(" ")
      .map((id) => clean(el.ownerDocument.getElementById(id)?.textContent))
      .filter(Boolean)
      .join(" ")
    if (text) return text
  }
  const labels = (el as HTMLInputElement).labels
  return labels && labels.length ? clean(labels[0].textContent) : ""
}

/** What a control says about itself, or null when it is not something the tour explains. */
export function infoOf(el: Element): ControlInfo | null {
  const tag = el.tagName.toLowerCase()
  const role = el.getAttribute("role")
  if (tag === "table") {
    return { kind: "table", headers: [...el.querySelectorAll("th")].map((th) => clean(th.textContent)) }
  }
  if (role === "tablist") {
    return { kind: "tabs", headers: [...el.querySelectorAll('[role="tab"]')].map((tab) => clean(tab.textContent)) }
  }
  const type = (el.getAttribute("type") ?? "").toLowerCase()
  if (role === "switch" || (tag === "input" && type === "checkbox")) {
    const on = role === "switch" ? el.getAttribute("aria-checked") === "true" : (el as HTMLInputElement).checked
    return { kind: "switch", label: nameOf(el), text: clean(el.textContent), on }
  }
  if (tag === "select" || role === "combobox") {
    const chosen = tag === "select" ? (el as HTMLSelectElement).selectedOptions[0]?.textContent : el.textContent
    return { kind: "select", label: nameOf(el), value: clean(chosen) }
  }
  if (tag === "textarea") {
    return { kind: "field", type: "textarea", label: nameOf(el), placeholder: clean(el.getAttribute("placeholder")) }
  }
  if (tag === "input") {
    if (["hidden", "radio", "submit", "button", "reset", "file", "image", "range", "color"].includes(type)) return null
    return { kind: "field", type: type || "text", label: nameOf(el), placeholder: clean(el.getAttribute("placeholder")) }
  }
  if (tag === "button" || tag === "a" || role === "button") {
    return { kind: "button", text: clean(el.textContent), label: nameOf(el) }
  }
  return null
}

const FIELDS = 'input, select, textarea, [role="switch"], [role="combobox"]'

/** Whether the nearest explained ancestor wraps this one field and nothing else - a form field
 *  with its hint - so the field is already covered. A page or card holding many is not a wrapper. */
function explainedByWrapper(el: Element): boolean {
  const wrapper = el.closest("[data-help]")
  return !!wrapper && wrapper.querySelectorAll(FIELDS).length === 1
}

const explicitText = (el: Element) =>
  clean(el.getAttribute("data-help")) || clean(el.getAttribute("data-tip")) || clean(el.getAttribute("title"))

/** Repeated controls in the same table column are one concept, even when their explicit
 *  help text makes each DOM node look unique to the generic de-duplicator. */
function tableRepeatGroup(el: Element, text: string, tableIds: Map<Element, number>): string | null {
  const row = el.closest("tbody tr") as HTMLTableRowElement | null
  const table = row?.closest("table")
  const cell = el.closest("td, th") as HTMLTableCellElement | null
  if (!row || !table || !cell || cell.closest("tr") !== row) return null
  let tableId = tableIds.get(table)
  if (tableId === undefined) {
    tableId = tableIds.size
    tableIds.set(table, tableId)
  }
  return `table:${tableId}:column:${cell.cellIndex}:${text}`
}

/**
 * Everything on screen worth explaining, in the order the tour visits it: what was written
 * for it first, and for the rest what its own wording says. A field inside something that
 * already explains it is not visited twice.
 */
export function collectTourSteps(doc: Document = document, showable: (el: Element) => boolean = isShowable): Step[] {
  // A dialog on top of the page is the only thing the member can be asking about.
  const dialogs = [...doc.querySelectorAll('[role="dialog"], [aria-modal="true"]')].filter(
    (dialog) => !isHiddenFromTour(dialog) && showable(dialog),
  )
  const scope: ParentNode = dialogs.length ? dialogs[dialogs.length - 1] : doc
  const items: (Candidate & Step)[] = []
  const tableIds = new Map<Element, number>()

  scope.querySelectorAll(`${EXPLAINABLE}, ${READABLE}`).forEach((el, order) => {
    if (el.closest(OWN_UI) || isHiddenFromTour(el) || !showable(el)) return
    let text = explicitText(el)
    let group = el.getAttribute("data-tour-repeat")
    let repeat = group !== null
    if (!text) {
      const info = el.matches(READABLE) ? infoOf(el) : null
      text = info ? describeControl(info) : ""
      if (!text) return
      const isField = info?.kind === "field" || info?.kind === "select" || info?.kind === "switch"
      if (isField && explainedByWrapper(el)) return
      // The same words over and over are one list of look-alike rows.
      group ??= `auto:${text}`
    }
    const tableGroup = tableRepeatGroup(el, text, tableIds)
    if (!repeat && tableGroup) {
      group = tableGroup
      repeat = true
    }
    items.push({
      el,
      text,
      order,
      rank: dialogs.length ? 0 : rankOf(el),
      group: group ?? `solo-${order}`,
      repeat,
    })
  })
  return orderForTour(items)
    .slice(0, MAX_STEPS)
    .map(({ el, text }) => ({ el, text }))
}
