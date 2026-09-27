// What a control on a page is for, worked out from what it says about itself: its own label,
// its column headers, its current value. Nothing here guesses at what a page does - a control
// whose purpose cannot be read from its wording gets no explanation rather than a made-up one.
//
// Self-contained on purpose (no imports), so it is tested straight from Node.

export type ControlInfo = {
  kind: "button" | "field" | "select" | "switch" | "table" | "tabs"
  /** The words on a button or link. */
  text?: string
  /** Its accessible name or the label beside it. */
  label?: string
  placeholder?: string
  /** An input's type ("date", "number", "search", "textarea"...). */
  type?: string
  /** A table's column headings, or a tab list's tab names. */
  headers?: string[]
  /** The current choice of a select. */
  value?: string
  on?: boolean
}

const MAX_NAME = 40
const MAX_HEADERS = 8

const VERBS: [RegExp, string][] = [
  [/^(export|download)\b/, "saves what you are looking at as a file"],
  [/^(upload|import)\b/, "brings data in from a file"],
  [/^(save|update)\b/, "saves your changes"],
  [/^(cancel|discard)\b/, "closes this without saving"],
  [/^(close|dismiss|done)\b/, "closes this"],
  [/^delete\b/, "deletes it. You may be asked to confirm"],
  [/^remove\b/, "removes it. You may be asked to confirm"],
  [/^archive\b/, "archives it"],
  [/^(edit|rename|change)\b/, "lets you change it"],
  [/^(approve|accept)\b/, "approves it"],
  [/^(reject|deny|decline)\b/, "rejects it"],
  [/^(submit|send)\b/, "sends it"],
  [/^(view|open|details|see)\b/, "opens it"],
  [/^(back|previous|prev)\b/, "goes back"],
  [/^(next|continue)\b/, "goes on to the next step or page"],
  [/^filters?\b/, "narrows what is listed"],
  [/^sort\b/, "changes the order of the list"],
  [/^apply\b/, "applies your choices"],
  [/^(reset|clear)\b/, "puts the filters or fields back to how they started"],
  [/^(refresh|reload|retry|try again)\b/, "loads the data again"],
  [/^copy\b/, "copies it"],
  [/^print\b/, "prints it"],
  [/^confirm\b/, "confirms it"],
  [/^(sign out|log out|logout)\b/, "signs you out"],
  [/^select all\b/, "selects everything in the list"],
  [/^(more|options|actions)\b/, "shows more actions for this item"],
  [/^(assign|reassign)\b/, "assigns it to someone"],
  [/^generate\b/, "builds it from your current choices"],
  [/^(remind|resend)\b/, "sends it again as a reminder"],
  [/^sync\b/, "brings it up to date"],
  [/^(connect|link)\b/, "connects it"],
  [/^(disconnect|unlink)\b/, "disconnects it"],
  [/^(enable|activate|turn on)\b/, "turns it on"],
  [/^(disable|deactivate|turn off)\b/, "turns it off"],
  [/^unban\b/, "lifts the ban"],
  [/^ban\b/, "bans the member"],
  [/^(transfer|move)\b/, "moves it somewhere else"],
  [/^(pay|mark as paid)\b/, "records a payment"],
  [/^restore\b/, "brings it back"],
  [/^(duplicate|clone)\b/, "makes a copy of it"],
  [/^share\b/, "shares it"],
  [/^(start|resume)\b/, "starts it"],
  [/^(stop|pause)\b/, "stops it for now"],
  [/^revoke\b/, "takes the access back"],
  [/^(review|resolve)\b/, "opens it so you can decide"],
  [/^request\b/, "sends a request"],
  [/^(log time|add time)\b/, "adds time that was not tracked"],
  [/^(manage|configure|settings)\b/, "opens its settings"],
  [/^preview\b/, "shows how it will look before it is sent"],
  [/^schedule\b/, "sets it to happen later or on repeat"],
  [/^upgrade\b/, "opens the plans you can move to"],
  [/^learn more\b/, "opens more information about it"],
  [/^show (all|more)\b/, "shows everything instead of a shortened list"],
  [/^(today|yesterday|this (week|month|year)|last (week|month|year|\d+ days))$/, "shows that period"],
  [/^(agree|accept and)\b/, "accepts and goes on"],
  [/^sign in\b/, "signs you in"],
]

function tidy(text: string | undefined): string {
  return (text ?? "").replace(/\s+/g, " ").replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N})]+$/gu, "").trim()
}

function cap(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1)
}

function forButton(info: ControlInfo): string {
  const name = tidy(info.text) || tidy(info.label)
  if (!name || name.length > MAX_NAME || /^\d+$/.test(name) || !/\p{L}/u.test(name)) return ""
  const lower = name.toLowerCase()

  const create = /^(add|new|create|invite)\b\s*(.*)$/.exec(lower)
  if (create) {
    const [, verb, rest] = create
    if (verb === "invite") return `${cap(name)}: invites ${rest ? `a ${rest}` : "someone"}.`
    return `${cap(name)}: ${verb === "add" && !rest ? "adds a new item" : `creates a new ${rest || "one"}`}.`
  }
  for (const [pattern, gloss] of VERBS) if (pattern.test(lower)) return `${cap(name)}: ${gloss}.`
  return ""
}

function forField(info: ControlInfo): string {
  const name = tidy(info.label) || tidy(info.placeholder)
  const type = (info.type ?? "text").toLowerCase()
  if (type === "search" || /\b(search|find|filter)\b/i.test(`${info.label ?? ""} ${info.placeholder ?? ""}`)) {
    return "Search: type to narrow what is listed."
  }
  if (!name) return ""
  const how: Record<string, string> = {
    date: "pick a date",
    "datetime-local": "pick a date and time",
    time: "pick a time",
    number: "enter a number",
    email: "enter an email address",
    password: "enter a password",
    tel: "enter a phone number",
    url: "enter a web address",
    textarea: "write it here",
  }
  return `${cap(name)}: ${how[type] ?? "type it here"}.`
}

function headings(list: string[] | undefined): string[] {
  const unique = [...new Set((list ?? []).map(tidy).filter(Boolean))]
  return unique.length > MAX_HEADERS ? [...unique.slice(0, MAX_HEADERS), "…"] : unique
}

/** The explanation for a control, or "" when its wording does not say what it is for. */
export function describeControl(info: ControlInfo): string {
  switch (info.kind) {
    case "button":
      return forButton(info)
    case "field":
      return forField(info)
    case "select": {
      const name = tidy(info.label)
      const value = tidy(info.value)
      return `${name ? `${cap(name)}: ` : ""}choose a value${value ? ` (now: ${value})` : ""}.`.replace(/^choose/, "Choose")
    }
    case "switch": {
      const name = tidy(info.label) || tidy(info.text)
      if (!name) return ""
      const state = info.on === undefined ? "" : ` (it is ${info.on ? "on" : "off"} now)`
      return `${cap(name)}: turn it on or off${state}.`
    }
    case "table": {
      const columns = headings(info.headers)
      return columns.length ? `A list with the columns ${columns.join(", ")}.` : ""
    }
    case "tabs": {
      const names = headings(info.headers)
      return names.length ? `Tabs: ${names.join(", ")}. Pick one to change what this page shows.` : ""
    }
  }
}
