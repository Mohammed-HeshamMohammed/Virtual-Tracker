"use client"

import { useState as useComponentState } from "react"
import { Check } from "lucide-react"
import { Button } from "@/shared/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/shared/ui/dialog"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/shared/ui/select"
import { cn } from "@/shared/utils/utils"
import { ReportModalFieldLabel } from "@/features/reports/components/amounts-owed/report-dialog-shared"
import { PAY_RATE_CURRENCIES } from "@/features/members/config/pay-currencies"

/** What the PDF is for, which decides what it says about money:
 *  the team's own report, what a client is charged, or what a member is paid. */
export type PdfDocumentKind = "report" | "client" | "payslip"

export interface PdfExportChoice {
  kind: PdfDocumentKind
  /** Team report only: print the Total spent card and column. */
  includeAmounts: boolean
  /** Blank keeps the currency the report is already showing. */
  currency: string
  /** Client statement only. */
  projectNames: string[]
  /** Pay slip only. */
  memberId: string
}

const AUTOMATIC = "__automatic"

const KIND_LABEL: Record<PdfDocumentKind, string> = {
  report: "Team report",
  client: "Client statement",
  payslip: "Pay slip",
}

const KIND_HELP: Record<PdfDocumentKind, string> = {
  report: "The table and charts as they are on screen, for your own team.",
  client: "The hours on a client's projects, priced at each project's client hourly rate.",
  payslip: "One member's hours, priced at their pay rate from the Members page.",
}

function FieldSelect({
  value,
  onChange,
  options,
  placeholder,
}: {
  value: string
  onChange: (next: string) => void
  options: { value: string; label: string }[]
  placeholder?: string
}) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger className="h-auto min-h-9 w-full border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 py-2 text-left shadow-xs">
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent className="z-100 max-h-72 overflow-y-auto scrollbar-hide">
        {options.map((o) => (
          <SelectItem key={o.value} value={o.value}>
            {o.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

export function PdfExportDialog({
  open,
  onOpenChange,
  onExport,
  moneyHidden,
  billingAvailable,
  resolvedCurrency,
  projectOptions,
  defaultProjectNames,
  projectsWithoutRate,
  memberOptions,
  defaultMemberId,
}: {
  open: boolean
  onOpenChange: (next: boolean) => void
  onExport: (choice: PdfExportChoice) => Promise<void> | void
  /** The viewer may not see pay or cost: only the team report, without amounts. */
  moneyHidden: boolean
  /** The viewer may see what clients are charged. */
  billingAvailable: boolean
  /** The currency the report is showing now. */
  resolvedCurrency: string
  projectOptions: string[]
  defaultProjectNames: string[]
  /** Which of the given projects have hours but no client rate. */
  projectsWithoutRate: (projectNames: string[]) => string[]
  memberOptions: { id: string; name: string }[]
  defaultMemberId: string
}) {
  const [kind, setKind] = useComponentState<PdfDocumentKind>("report")
  const [includeAmounts, setIncludeAmounts] = useComponentState(false)
  const [currency, setCurrency] = useComponentState(AUTOMATIC)
  const [projectNames, setProjectNames] = useComponentState<string[]>([])
  const [memberId, setMemberId] = useComponentState("")
  const [error, setError] = useComponentState<string | null>(null)
  const [working, setWorking] = useComponentState(false)

  // Reset on open, like the Send dialog beside it - except the document type
  // and the amounts switch, which are the viewer's habit rather than this
  // export's details and so carry over while the page stays open.
  const [prevOpen, setPrevOpen] = useComponentState(open)
  if (open !== prevOpen) {
    setPrevOpen(open)
    if (open) {
      setCurrency(AUTOMATIC)
      setProjectNames(defaultProjectNames.filter((name) => projectOptions.includes(name)))
      setMemberId(memberOptions.some((m) => m.id === defaultMemberId) ? defaultMemberId : (memberOptions[0]?.id ?? ""))
      setError(null)
      setWorking(false)
      if (moneyHidden || (kind === "client" && !billingAvailable)) setKind("report")
    }
  }

  const kinds: PdfDocumentKind[] = moneyHidden ? ["report"] : billingAvailable ? ["report", "client", "payslip"] : ["report", "payslip"]
  // The team report prints the amounts the page is already showing, so its
  // currency is the page's (Filter > Display currency). The two documents are
  // priced fresh, and can be asked for in another one.
  const picksCurrency = kind !== "report"
  const unpriced = kind === "client" ? projectsWithoutRate(projectNames) : []

  function toggleProject(name: string) {
    setProjectNames((prev) => (prev.includes(name) ? prev.filter((n) => n !== name) : [...prev, name]))
  }

  async function handleExport() {
    if (kind === "payslip" && !memberId) {
      setError("Choose whose pay slip to make.")
      return
    }
    if (kind === "client" && projectOptions.length === 0) {
      setError("There is no project time in this date range to bill for.")
      return
    }
    setError(null)
    setWorking(true)
    try {
      await onExport({
        kind,
        includeAmounts: kind === "report" ? includeAmounts && !moneyHidden : true,
        currency: currency === AUTOMATIC ? "" : currency,
        projectNames,
        memberId,
      })
      onOpenChange(false)
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not build the PDF.")
    } finally {
      setWorking(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        showCloseButton
        className="flex max-h-[min(90vh,640px)] w-full max-w-[calc(100%-2rem)] flex-col gap-0 overflow-hidden rounded-lg border-slate-200 dark:border-slate-700 p-0 sm:max-w-lg"
      >
        <DialogHeader className="space-y-0 border-b border-slate-100 dark:border-slate-800 px-6 pt-6 pr-14 pb-4 text-left">
          <DialogTitle className="text-base font-semibold text-slate-900 dark:text-slate-100">Export to PDF</DialogTitle>
          <DialogDescription className="sr-only">Choose the document, its contents, and currency before downloading.</DialogDescription>
        </DialogHeader>

        <div className="flex-1 space-y-5 overflow-y-auto px-6 py-5 scrollbar-hide">
          {error ? (
            <p className="rounded-lg border border-red-200 dark:border-red-900/60 bg-red-50 dark:bg-red-950/40 px-3 py-2 text-sm text-red-700 dark:text-red-400">
              {error}
            </p>
          ) : null}

          <div className="space-y-1.5">
            <ReportModalFieldLabel>Document</ReportModalFieldLabel>
            <FieldSelect
              value={kind}
              onChange={(next) => setKind(next as PdfDocumentKind)}
              options={kinds.map((k) => ({ value: k, label: KIND_LABEL[k] }))}
            />
            <p className="text-xs text-slate-500 dark:text-slate-400">{KIND_HELP[kind]}</p>
          </div>

          {kind === "report" && !moneyHidden ? (
            <label className="flex cursor-pointer items-start gap-3">
              <input
                type="checkbox"
                checked={includeAmounts}
                onChange={(e) => setIncludeAmounts(e.target.checked)}
                className="mt-0.5 h-4 w-4 rounded border-slate-300 text-blue-500 focus:ring-blue-500 dark:border-slate-600"
              />
              <span>
                <span className="block text-sm text-slate-700 dark:text-slate-200">Include amounts</span>
                <span className="block text-xs text-slate-500 dark:text-slate-400">
                  Adds Total spent - what the time cost in pay. Leave off for a report about time only.
                </span>
              </span>
            </label>
          ) : null}

          {kind === "client" ? (
            <div className="space-y-1.5">
              <ReportModalFieldLabel>Projects</ReportModalFieldLabel>
              {projectOptions.length === 0 ? (
                <p className="text-sm text-slate-500 dark:text-slate-400">No project has time in this date range.</p>
              ) : (
                <div className="max-h-44 overflow-y-auto rounded-lg border border-slate-200 dark:border-slate-700 py-1 scrollbar-hide">
                  {projectOptions.map((name) => {
                    const on = projectNames.includes(name)
                    return (
                      <button
                        key={name}
                        type="button"
                        role="checkbox"
                        aria-checked={on}
                        onClick={() => toggleProject(name)}
                        className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm text-slate-700 transition-colors hover:bg-slate-50 dark:text-slate-200 dark:hover:bg-slate-800"
                      >
                        <span
                          className={cn(
                            "flex h-4 w-4 shrink-0 items-center justify-center rounded border",
                            on ? "border-blue-500 bg-blue-500" : "border-slate-300 dark:border-slate-600",
                          )}
                        >
                          {on ? <Check className="h-3 w-3 text-white" strokeWidth={3} /> : null}
                        </span>
                        <span className="truncate">{name}</span>
                      </button>
                    )
                  })}
                </div>
              )}
              <p className="text-xs text-slate-500 dark:text-slate-400">
                {projectNames.length === 0 ? "None ticked: every project in the range is included." : `${projectNames.length} selected.`}
              </p>
              {unpriced.length > 0 ? (
                <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-300">
                  No client hourly rate is set for {unpriced.join(", ")}. Their hours will be listed without an amount -
                  set the rate on the project (General &gt; Client hourly rate) to price them.
                </p>
              ) : null}
            </div>
          ) : null}

          {kind === "payslip" ? (
            <div className="space-y-1.5">
              <ReportModalFieldLabel required>Member</ReportModalFieldLabel>
              {memberOptions.length === 0 ? (
                <p className="text-sm text-slate-500 dark:text-slate-400">Nobody has time in this date range.</p>
              ) : (
                <FieldSelect
                  value={memberId}
                  onChange={setMemberId}
                  options={memberOptions.map((m) => ({ value: m.id, label: m.name }))}
                  placeholder="Choose a member"
                />
              )}
            </div>
          ) : null}

          {picksCurrency ? (
            <div className="space-y-1.5">
              <ReportModalFieldLabel>Currency</ReportModalFieldLabel>
              <FieldSelect
                value={currency}
                onChange={setCurrency}
                options={[
                  { value: AUTOMATIC, label: resolvedCurrency ? `Same as the report (${resolvedCurrency})` : "Same as the report" },
                  ...PAY_RATE_CURRENCIES.map((c) => ({ value: c.value, label: c.label })),
                ]}
              />
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Every amount in the document is converted into this currency at the rate of the day the time was worked.
              </p>
            </div>
          ) : null}
        </div>

        <DialogFooter className="gap-2 border-t border-slate-100 dark:border-slate-800 px-6 py-4 sm:justify-end">
          <Button
            type="button"
            variant="outline"
            className="border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900"
            onClick={() => onOpenChange(false)}
          >
            Cancel
          </Button>
          <Button
            type="button"
            className="bg-sky-400 dark:bg-sky-500 text-white hover:bg-sky-500 dark:hover:bg-sky-600"
            onClick={handleExport}
            disabled={working}
          >
            {working ? "Building…" : "Download PDF"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
