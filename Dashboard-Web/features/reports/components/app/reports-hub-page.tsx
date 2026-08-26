"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { BarChart3, ChevronRight, Clock, Loader2, Search, Star, Trash2, Wallet, Zap } from "lucide-react"
import { cn } from "@/shared/utils/utils"
import { useAuth, useTheme } from "@/shared/providers/app"
import { usePageSearch } from "@/shared/ui/layout"
import { isPageAllowedForRole } from "@/features/auth/permissions/member-role-access"
import {
  POPULAR_REPORTS,
  REPORT_SECTIONS,
  type ReportCatalogCard,
} from "@/features/reports/catalog"
import {
  fetchSavedReports,
  removeSavedReport,
  saveReport,
  type SavedReport,
} from "@/features/reports/api/saved-reports-api"

/** One icon per popular card, in the order the catalog lists them. */
const POPULAR_ICONS = [Clock, Wallet, BarChart3] as const

function matchesQuery(card: ReportCatalogCard, query: string): boolean {
  const needle = query.trim().toLowerCase()
  if (!needle) return true
  return card.title.toLowerCase().includes(needle) || card.description.toLowerCase().includes(needle)
}

export function ReportsHubPage({ onNavigate }: { onNavigate: (id: string) => void }) {
  const { isDark } = useTheme()
  const { memberRole } = useAuth()
  const { query, setQuery } = usePageSearch()

  const [saved, setSaved] = useState<SavedReport[]>([])
  const [savedLoading, setSavedLoading] = useState(true)
  const [savedError, setSavedError] = useState<string | null>(null)
  const [pending, setPending] = useState<string | null>(null)

  // Only reports this role may actually open. Same rule the sidebar and
  // deep-link coercion use, so the hub can never offer a card that bounces the
  // viewer back to the dashboard.
  const role = memberRole ?? ""
  const allowed = useCallback((card: ReportCatalogCard) => isPageAllowedForRole(card.pageId, role), [role])

  const popular = useMemo(
    () => POPULAR_REPORTS.filter((card) => allowed(card) && matchesQuery(card, query)),
    [allowed, query],
  )
  const sections = useMemo(
    () =>
      REPORT_SECTIONS.map((section) => ({
        heading: section.heading,
        cards: section.cards.filter((card) => allowed(card) && matchesQuery(card, query)),
      })).filter((section) => section.cards.length > 0),
    [allowed, query],
  )

  useEffect(() => {
    const controller = new AbortController()
    fetchSavedReports(controller.signal)
      .then((rows) => {
        setSaved(rows)
        setSavedError(null)
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return
        setSavedError(error instanceof Error ? error.message : "Failed to load saved reports")
      })
      .finally(() => {
        if (!controller.signal.aborted) setSavedLoading(false)
      })
    return () => controller.abort()
  }, [])

  const savedByPageId = useMemo(() => new Map(saved.map((row) => [row.pageId, row])), [saved])

  const togglePin = useCallback(
    async (card: ReportCatalogCard) => {
      const existing = savedByPageId.get(card.pageId)
      setPending(card.pageId)
      try {
        if (existing) {
          await removeSavedReport(existing.id)
          setSaved((prev) => prev.filter((row) => row.id !== existing.id))
        } else {
          const row = await saveReport({ pageId: card.pageId, title: card.title, tag: card.section ?? "Popular" })
          setSaved((prev) => [row, ...prev.filter((r) => r.pageId !== row.pageId)])
        }
        setSavedError(null)
      } catch (error: unknown) {
        setSavedError(error instanceof Error ? error.message : "Could not update saved reports")
      } finally {
        setPending(null)
      }
    },
    [savedByPageId],
  )

  const visibleSaved = saved.filter(
    (row) => isPageAllowedForRole(row.pageId, role) && (!query.trim() || row.title.toLowerCase().includes(query.trim().toLowerCase())),
  )

  const nothingToShow = popular.length === 0 && sections.length === 0 && visibleSaved.length === 0

  return (
    <div
      className={cn(
        "mx-auto w-full max-w-7xl space-y-12 px-4 py-8 sm:px-6 lg:px-8",
        isDark ? "text-[#dce1fb]" : "text-slate-900",
      )}
    >
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <h2 className={cn("shrink-0 text-lg font-bold", isDark ? "text-[#dce1fb]" : "text-slate-900")}>
          Customized reports
        </h2>
        <div
          className={cn(
            "flex w-full max-w-md shrink-0 items-center gap-2 rounded-full border px-4 py-2.5 sm:ml-auto sm:w-80 sm:max-w-none",
            isDark ? "border-white/10 bg-[#191f31]" : "border-slate-200 bg-white",
          )}
        >
          <Search className={cn("h-4 w-4 shrink-0", isDark ? "text-white/35" : "text-slate-400")} />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search reports"
            aria-label="Search reports"
            className={cn(
              "min-w-0 flex-1 border-0 bg-transparent text-sm outline-none focus:ring-0",
              isDark ? "text-[#dce1fb] placeholder:text-white/30" : "text-slate-800 placeholder:text-slate-400",
            )}
          />
        </div>
      </div>

      {/* Saved reports - persisted per member, so a pin survives a reload and a
          removal stays removed. */}
      <section className="mt-4 space-y-3">
        {savedError && (
          <p className="text-sm text-rose-500 dark:text-rose-400">{savedError}</p>
        )}
        {savedLoading ? (
          <p className={cn("flex items-center gap-2 text-sm", isDark ? "text-white/40" : "text-slate-500")}>
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading saved reports
          </p>
        ) : visibleSaved.length === 0 ? (
          <p className={cn("text-sm", isDark ? "text-white/40" : "text-slate-500")}>
            {saved.length === 0
              ? "No saved reports yet — use the star on any report below to pin it here."
              : "No matches for your search."}
          </p>
        ) : (
          <div className="flex flex-wrap gap-3">
            {visibleSaved.map((row) => (
              <div
                key={row.id}
                className={cn(
                  "relative flex min-w-[200px] max-w-xs flex-1 flex-col rounded-xl border p-4 transition-shadow hover:shadow-md",
                  isDark ? "border-white/10 bg-white/5" : "border-slate-200 bg-white",
                )}
              >
                <div className="flex items-start justify-between gap-2">
                  <button
                    type="button"
                    onClick={() => onNavigate(row.pageId)}
                    className="text-left text-sm font-bold hover:underline"
                  >
                    {row.title}
                  </button>
                  <button
                    type="button"
                    disabled={pending === row.pageId}
                    onClick={() => {
                      void removeSavedReport(row.id)
                        .then(() => setSaved((prev) => prev.filter((r) => r.id !== row.id)))
                        .catch(() => setSavedError("Could not remove that saved report"))
                    }}
                    className={cn(
                      "shrink-0 rounded-lg p-1 transition-colors disabled:opacity-50",
                      isDark
                        ? "text-white/40 hover:bg-white/10 hover:text-white/70"
                        : "text-slate-400 hover:bg-slate-100 hover:text-slate-600",
                    )}
                    aria-label={`Remove ${row.title}`}
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
                {row.tag && (
                  <span
                    className={cn(
                      "mt-3 inline-flex w-fit rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
                      isDark ? "bg-white/10 text-[#bccbb9]" : "bg-slate-100 text-slate-600",
                    )}
                  >
                    {row.tag}
                  </span>
                )}
              </div>
            ))}
          </div>
        )}
      </section>

      {nothingToShow && !savedLoading && (
        <p className={cn("text-sm", isDark ? "text-white/40" : "text-slate-500")}>
          {query.trim() ? "No reports match your search." : "Your role does not have access to any reports."}
        </p>
      )}

      {popular.length > 0 && (
        <section>
          <h2 className={cn("mb-4 text-lg font-bold", isDark ? "text-[#dce1fb]" : "text-slate-900")}>Popular reports</h2>
          <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
            {popular.map((card, index) => {
              const Icon = POPULAR_ICONS[index % POPULAR_ICONS.length]
              return (
                <div
                  key={card.pageId}
                  className={cn(
                    "relative flex flex-col rounded-2xl border p-6 transition-all hover:-translate-y-0.5 hover:shadow-lg",
                    isDark
                      ? "border-sky-500/20 bg-linear-to-b from-sky-950/80 to-[#151b2d]"
                      : "border-sky-100 bg-linear-to-b from-sky-50 to-sky-100/80",
                  )}
                >
                  <div className="flex items-start justify-between gap-2">
                    <Icon className={cn("h-8 w-8", isDark ? "text-sky-300" : "text-sky-600")} />
                    <div className="flex items-center gap-2">
                      {card.badge && (
                        <span className="inline-flex items-center gap-1 rounded-full bg-violet-500 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-white">
                          <Zap className="h-3 w-3" />
                          {card.badge}
                        </span>
                      )}
                      <PinButton
                        card={card}
                        pinned={savedByPageId.has(card.pageId)}
                        busy={pending === card.pageId}
                        isDark={isDark}
                        onToggle={togglePin}
                      />
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => onNavigate(card.pageId)}
                    className="mt-4 text-left"
                  >
                    <h3 className={cn("text-xl font-bold", isDark ? "text-[#dce1fb]" : "text-slate-900")}>
                      {card.title}
                    </h3>
                    <p className={cn("mt-2 text-sm leading-relaxed", isDark ? "text-[#bccbb9]" : "text-slate-600")}>
                      {card.description}
                    </p>
                  </button>
                </div>
              )
            })}
          </div>
        </section>
      )}

      {sections.map((section) => (
        <section key={section.heading}>
          <h2 className={cn("mb-4 text-lg font-bold", isDark ? "text-[#dce1fb]" : "text-slate-900")}>
            {section.heading}
          </h2>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {section.cards.map((card) => (
              <div
                key={card.pageId}
                className={cn(
                  "flex flex-col rounded-xl border p-4 transition-all hover:shadow-md",
                  isDark
                    ? "border-white/10 bg-white/5 hover:border-white/20"
                    : "border-slate-200 bg-white hover:border-slate-300",
                )}
              >
                <div className="flex items-start justify-between gap-2">
                  <button
                    type="button"
                    onClick={() => onNavigate(card.pageId)}
                    className={cn(
                      "flex-1 text-left text-sm font-bold hover:underline",
                      isDark ? "text-[#dce1fb]" : "text-slate-900",
                    )}
                  >
                    {card.title}
                  </button>
                  <PinButton
                    card={card}
                    pinned={savedByPageId.has(card.pageId)}
                    busy={pending === card.pageId}
                    isDark={isDark}
                    onToggle={togglePin}
                  />
                </div>
                <button
                  type="button"
                  onClick={() => onNavigate(card.pageId)}
                  className="mt-2 flex items-end justify-between gap-2 text-left"
                >
                  <span className={cn("text-xs leading-relaxed", isDark ? "text-[#bccbb9]" : "text-slate-500")}>
                    {card.description}
                  </span>
                  <ChevronRight
                    className={cn("h-4 w-4 shrink-0 opacity-40", isDark ? "text-white" : "text-slate-500")}
                  />
                </button>
              </div>
            ))}
          </div>
        </section>
      ))}
    </div>
  )
}

function PinButton({
  card,
  pinned,
  busy,
  isDark,
  onToggle,
}: {
  card: ReportCatalogCard
  pinned: boolean
  busy: boolean
  isDark: boolean
  onToggle: (card: ReportCatalogCard) => void
}) {
  return (
    <button
      type="button"
      disabled={busy}
      onClick={() => onToggle(card)}
      aria-pressed={pinned}
      aria-label={pinned ? `Unpin ${card.title}` : `Pin ${card.title} to customized reports`}
      className={cn(
        "shrink-0 rounded-lg p-1 transition-colors disabled:opacity-50",
        pinned
          ? "text-amber-500"
          : isDark
            ? "text-white/30 hover:bg-white/10 hover:text-white/60"
            : "text-slate-300 hover:bg-slate-100 hover:text-slate-500",
      )}
    >
      {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Star className={cn("h-4 w-4", pinned && "fill-current")} />}
    </button>
  )
}
