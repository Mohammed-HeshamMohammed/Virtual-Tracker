"use client"

import { useSyncExternalStore } from "react"
import { apiPath } from "@/infrastructure/api/path"
import { fetchJsonWithRetry } from "@/infrastructure/api/http"
import { coalesceRequest } from "@/infrastructure/api/request-coalesce"

/**
 * The one currency the workspace counts in.
 *
 * Every money figure the backend hands the dashboard - a project's spend, a
 * budget, a client's bill rate - has already been converted into this currency
 * (see Dashboard-Backend/src/lib/currency). The dashboard used to print a "$"
 * in front of all of them regardless, so a workspace counting in Egyptian
 * pounds read its own budgets as dollars.
 *
 * It is one value for the whole workspace and it barely ever changes, so it
 * lives in a module-level store rather than a context: anything can read it
 * synchronously, and `useWorkspaceCurrency` re-renders the few components that
 * show money once it has loaded.
 *
 * A member's own pay rate is *not* this - that is stored and shown in the
 * currency they are paid in.
 */

const FALLBACK = "USD"
const SETTINGS_KEY = "workspace-currency"

let currency = FALLBACK
let loaded = false
const listeners = new Set<() => void>()

function emit() {
  for (const listener of listeners) listener()
}

/** The workspace currency as currently known - "USD" until it has loaded. */
export function getWorkspaceCurrency(): string {
  return currency
}

export function setWorkspaceCurrency(code: string | null | undefined): void {
  const next = String(code ?? "").trim().toUpperCase()
  if (!next || next === currency) return
  currency = next
  emit()
}

/** Loads it once per page. Safe to call from anywhere, as often as you like. */
export function loadWorkspaceCurrency(): void {
  if (loaded || typeof window === "undefined") return
  loaded = true
  void coalesceRequest(SETTINGS_KEY, async () => {
    const { res, json } = await fetchJsonWithRetry<{ data?: { orgCurrency?: string } }>(
      apiPath("/api/reports/currency"),
    )
    if (res.ok) setWorkspaceCurrency(json?.data?.orgCurrency)
    return null
  }).catch(() => {
    // The fallback is already in place; money still renders, in USD.
  })
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  loadWorkspaceCurrency()
  return () => {
    listeners.delete(listener)
  }
}

export function useWorkspaceCurrency(): string {
  return useSyncExternalStore(subscribe, getWorkspaceCurrency, () => FALLBACK)
}

/**
 * An amount in a currency, the way the platform's locale writes it.
 *
 * `compact` shortens four figures and up ("EGP 12.4k"), which is what the
 * narrow budget columns need; everything else gets the exact amount.
 */
export function formatMoney(
  amount: number,
  currencyCode: string = getWorkspaceCurrency(),
  options: { compact?: boolean } = {},
): string {
  const value = Number.isFinite(amount) ? amount : 0
  const code = (currencyCode || FALLBACK).toUpperCase()
  const compact = options.compact === true && Math.abs(value) >= 1000
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency: code,
      currencyDisplay: "narrowSymbol",
      ...(compact
        ? { notation: "compact", maximumFractionDigits: 1 }
        : { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
    }).format(value)
  } catch {
    // An unknown code (Intl throws on those) still has to print something.
    return `${code} ${compact ? `${(value / 1000).toFixed(1)}k` : value.toFixed(2)}`
  }
}

/** Just the symbol, for the prefix inside an amount input. */
export function currencySymbol(currencyCode: string = getWorkspaceCurrency()): string {
  const code = (currencyCode || FALLBACK).toUpperCase()
  try {
    const parts = new Intl.NumberFormat(undefined, {
      style: "currency",
      currency: code,
      currencyDisplay: "narrowSymbol",
    }).formatToParts(0)
    return parts.find((part) => part.type === "currency")?.value ?? code
  } catch {
    return code
  }
}
