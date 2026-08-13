"use client"

import { useEffect, useMemo, useState as useComponentState } from "react"
import { Info } from "lucide-react"
import { Button } from "@/shared/ui/button"
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/shared/ui/dialog"
import { Input } from "@/shared/ui/input"
import { Textarea } from "@/shared/ui/textarea"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/shared/ui/tooltip"
import {
  AMOUNTS_OWED_SCHEDULE_SUBJECT_DEFAULT,
  DELIVERY_FREQUENCY_OPTIONS,
  SCHEDULE_REPORT_DATE_RANGE_OPTIONS,
} from "@/features/reports/components/shared/constants"
import { buildDeliveryTimeOptions } from "@/features/reports/utils/delivery-times"
import { ReportCombobox } from "@/features/reports/components/amounts-owed/report-combobox"
import { ReportFileTypeSelect, ReportModalFieldLabel } from "@/features/reports/components/amounts-owed/report-dialog-shared"
import { validateEmailList, validateRequiredText } from "@/shared/validation"

const DEFAULT_DELIVERY_TIME = "8:30 am"

export interface ReportScheduleInput {
  emails: string[]
  subject: string
  message: string
  fileType: string
  scheduleName: string
  dateRange: string
  frequency: string
  deliveryTime: string
}

export function ReportScheduleDialog({
  open,
  onOpenChange,
  hasFiltersApplied = false,
  onRequestOpenFilters,
  onSave,
}: {
  open: boolean
  onOpenChange: (next: boolean) => void
  /** When false, copy matches “no filters applied” helper text. */
  hasFiltersApplied?: boolean
  /** Opens the report filters panel (e.g. close this dialog and open filters). */
  onRequestOpenFilters?: () => void
  /** When provided, called on Save instead of just closing the dialog (real persistence). */
  onSave?: (input: ReportScheduleInput) => Promise<void> | void
}) {
  const deliveryTimeOptions = useMemo(() => buildDeliveryTimeOptions(), [])

  const [emails, setEmails] = useComponentState("")
  const [subject, setSubject] = useComponentState(AMOUNTS_OWED_SCHEDULE_SUBJECT_DEFAULT)
  const [message, setMessage] = useComponentState("")
  const [fileType, setFileType] = useComponentState("PDF")
  const [scheduleName, setScheduleName] = useComponentState("")
  const [dateRange, setDateRange] = useComponentState("")
  const [frequency, setFrequency] = useComponentState("")
  const [deliveryTime, setDeliveryTime] = useComponentState(DEFAULT_DELIVERY_TIME)
  const [submitError, setSubmitError] = useComponentState<string | null>(null)
  const [saving, setSaving] = useComponentState(false)

  const [prevOpen, setPrevOpen] = useComponentState(open)

  if (open !== prevOpen) {
    setPrevOpen(open)
    if (open) {
      setEmails("")
      setSubject(AMOUNTS_OWED_SCHEDULE_SUBJECT_DEFAULT)
      setMessage("")
      setFileType("PDF")
      setScheduleName("")
      setDateRange("")
      setFrequency("")
      setDeliveryTime(DEFAULT_DELIVERY_TIME)
      setSubmitError(null)
      setSaving(false)
    }
  }

  async function handleSave() {
    const validationError =
      validateEmailList(emails) ??
      validateRequiredText(scheduleName.trim(), "Schedule name") ??
      validateRequiredText(dateRange.trim(), "Date range") ??
      validateRequiredText(frequency.trim(), "Delivery frequency")
    if (validationError) {
      setSubmitError(validationError)
      return
    }
    setSubmitError(null)

    if (!onSave) {
      onOpenChange(false)
      return
    }

    const emailList = emails.split(",").map((e) => e.trim()).filter(Boolean)
    setSaving(true)
    try {
      await onSave({
        emails: emailList,
        subject: subject.trim(),
        message,
        fileType,
        scheduleName: scheduleName.trim(),
        dateRange: dateRange.trim(),
        frequency: frequency.trim(),
        deliveryTime,
      })
      onOpenChange(false)
    } catch (e) {
      setSubmitError(e instanceof Error ? e.message : "Failed to save schedule.")
    } finally {
      setSaving(false)
    }
  }

  function handleOpenFiltersLink() {
    onOpenChange(false)
    onRequestOpenFilters?.()
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        showCloseButton
        className="flex max-h-[min(92vh,760px)] w-full max-w-[calc(100%-2rem)] flex-col gap-0 overflow-hidden rounded-lg border-slate-200 dark:border-slate-700 p-0 sm:max-w-2xl"
      >
        <DialogHeader className="space-y-0 border-b border-slate-100 dark:border-slate-800 px-6 pt-6 pr-14 pb-4 text-left">
          <DialogTitle className="text-base font-semibold text-slate-900 dark:text-slate-100">Schedule report</DialogTitle>
        </DialogHeader>

        <div className="flex-1 space-y-5 overflow-y-auto px-6 py-5 scrollbar-hide">
          {submitError ? (
            <p className="rounded-lg border border-red-200 dark:border-red-900/60 bg-red-50 dark:bg-red-950/40 px-3 py-2 text-sm text-red-700 dark:text-red-400">{submitError}</p>
          ) : null}
          <div className="space-y-2">
            <div className="flex items-center gap-1.5">
              <ReportModalFieldLabel>Data filters</ReportModalFieldLabel>
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    className="rounded-full p-0.5 text-slate-400 dark:text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800 hover:text-slate-600 dark:hover:text-slate-300"
                    aria-label="About data filters"
                  >
                    <Info className="h-3.5 w-3.5" />
                  </button>
                </TooltipTrigger>
                <TooltipContent side="top" className="max-w-xs text-xs">
                  Scheduled exports use the filter set saved with this schedule. Adjust filters on the report before saving.
                </TooltipContent>
              </Tooltip>
            </div>
            {hasFiltersApplied ? (
              <p className="text-sm text-slate-600 dark:text-slate-300">Current report filters will apply to this schedule.</p>
            ) : (
              <p className="text-sm text-slate-600 dark:text-slate-300">
                No filters applied. To add filters view{" "}
                <button
                  type="button"
                  className="font-medium text-blue-600 dark:text-blue-400 underline-offset-2 hover:underline"
                  onClick={handleOpenFiltersLink}
                >
                  filters
                </button>{" "}
                on the report page.
              </p>
            )}
          </div>

          <div className="space-y-1.5">
            <ReportModalFieldLabel required>Email addresses</ReportModalFieldLabel>
            <p className="text-xs text-slate-500 dark:text-slate-400">Separate email addresses with commas</p>
            <Input
              value={emails}
              onChange={(e) => setEmails(e.target.value)}
              className="border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 shadow-xs"
              autoComplete="email"
            />
          </div>

          <div className="space-y-1.5">
            <ReportModalFieldLabel>Subject</ReportModalFieldLabel>
            <Input
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              className="border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 shadow-xs"
            />
          </div>

          <div className="space-y-1.5">
            <ReportModalFieldLabel required>Message</ReportModalFieldLabel>
            <Textarea
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder="Enter a message"
              className="min-h-[100px] resize-y border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 shadow-xs"
            />
          </div>

          <div className="space-y-1.5">
            <ReportModalFieldLabel>File type</ReportModalFieldLabel>
            <ReportFileTypeSelect value={fileType} onChange={setFileType} />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <ReportModalFieldLabel required>Name</ReportModalFieldLabel>
              <Input
                value={scheduleName}
                onChange={(e) => setScheduleName(e.target.value)}
                className="border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 shadow-xs"
              />
            </div>
            <div className="space-y-1.5">
              <ReportModalFieldLabel required>Date range</ReportModalFieldLabel>
              <ReportCombobox
                value={dateRange}
                onChange={setDateRange}
                options={SCHEDULE_REPORT_DATE_RANGE_OPTIONS}
                placeholder="Select date range"
                aria-label="Date range"
              />
            </div>
            <div className="space-y-1.5">
              <ReportModalFieldLabel required>Delivery frequency</ReportModalFieldLabel>
              <ReportCombobox
                value={frequency}
                onChange={setFrequency}
                options={DELIVERY_FREQUENCY_OPTIONS}
                placeholder="Select frequency"
                aria-label="Delivery frequency"
              />
            </div>
            <div className="space-y-1.5">
              <div className="flex items-center gap-1.5">
                <ReportModalFieldLabel>Delivery time</ReportModalFieldLabel>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      type="button"
                      className="rounded-full p-0.5 text-slate-400 dark:text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800 hover:text-slate-600 dark:hover:text-slate-300"
                      aria-label="About delivery time"
                    >
                      <Info className="h-3.5 w-3.5" />
                    </button>
                  </TooltipTrigger>
                  <TooltipContent side="top" className="max-w-xs text-xs">
                    Local time for sending the report. Times are available every 30 minutes across the full day.
                  </TooltipContent>
                </Tooltip>
              </div>
              <ReportCombobox
                value={deliveryTime}
                onChange={setDeliveryTime}
                options={deliveryTimeOptions}
                placeholder="Select time"
                aria-label="Delivery time"
              />
            </div>
          </div>
        </div>

        <DialogFooter className="gap-2 border-t border-slate-100 dark:border-slate-800 px-6 py-4 sm:justify-end">
          <Button type="button" variant="outline" className="border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            type="button"
            className="bg-sky-400 dark:bg-sky-500 text-white hover:bg-sky-500 dark:hover:bg-sky-600"
            onClick={handleSave}
            disabled={saving}
          >
            {saving ? "Saving…" : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

