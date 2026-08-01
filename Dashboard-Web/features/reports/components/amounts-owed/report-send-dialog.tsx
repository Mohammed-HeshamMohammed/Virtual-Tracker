"use client"

import { useEffect, useState as useComponentState } from "react"
import { Button } from "@/shared/ui/button"
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/shared/ui/dialog"
import { Input } from "@/shared/ui/input"
import { Textarea } from "@/shared/ui/textarea"
import {
  AMOUNTS_OWED_SEND_SUBJECT_DEFAULT,
  REPORT_EMAIL_DEFAULT_MESSAGE,
} from "@/features/reports/components/shared/constants"
import { ReportFileTypeSelect, ReportModalFieldLabel } from "@/features/reports/components/amounts-owed/report-dialog-shared"
import { validateEmailList, validateRequiredText } from "@/shared/validation"

export interface ReportSendInput {
  emails: string[]
  subject: string
  message: string
  fileType: string
}

export function ReportSendDialog({
  open,
  onOpenChange,
  onSend,
}: {
  open: boolean
  onOpenChange: (next: boolean) => void
  /** When provided, called on Send instead of just closing the dialog (real delivery). */
  onSend?: (input: ReportSendInput) => Promise<void> | void
}) {
  const [emails, setEmails] = useComponentState("")
  const [subject, setSubject] = useComponentState(AMOUNTS_OWED_SEND_SUBJECT_DEFAULT)
  const [message, setMessage] = useComponentState(REPORT_EMAIL_DEFAULT_MESSAGE)
  const [fileType, setFileType] = useComponentState("PDF")
  const [submitError, setSubmitError] = useComponentState<string | null>(null)
  const [sending, setSending] = useComponentState(false)

  const [prevOpen, setPrevOpen] = useComponentState(open)

  if (open !== prevOpen) {
    setPrevOpen(open)
    if (open) {
      setEmails("")
      setSubject(AMOUNTS_OWED_SEND_SUBJECT_DEFAULT)
      setMessage(REPORT_EMAIL_DEFAULT_MESSAGE)
      setFileType("PDF")
      setSubmitError(null)
      setSending(false)
    }
  }

  async function handleSend() {
    const validationError =
      validateEmailList(emails) ?? validateRequiredText(subject.trim(), "Subject")
    if (validationError) {
      setSubmitError(validationError)
      return
    }
    setSubmitError(null)

    if (!onSend) {
      onOpenChange(false)
      return
    }

    const emailList = emails.split(",").map((e) => e.trim()).filter(Boolean)
    setSending(true)
    try {
      await onSend({ emails: emailList, subject: subject.trim(), message, fileType })
      onOpenChange(false)
    } catch (e) {
      setSubmitError(e instanceof Error ? e.message : "Failed to send report.")
    } finally {
      setSending(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        showCloseButton
        className="flex max-h-[min(90vh,640px)] w-full max-w-[calc(100%-2rem)] flex-col gap-0 overflow-hidden rounded-lg border-slate-200 p-0 sm:max-w-lg"
      >
        <DialogHeader className="space-y-0 border-b border-slate-100 px-6 pt-6 pr-14 pb-4 text-left">
          <DialogTitle className="text-base font-semibold text-slate-900">Send report</DialogTitle>
        </DialogHeader>

        <div className="flex-1 space-y-5 overflow-y-auto px-6 py-5 scrollbar-hide">
          {submitError ? (
            <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{submitError}</p>
          ) : null}
          <div className="space-y-1.5">
            <ReportModalFieldLabel required>Email addresses</ReportModalFieldLabel>
            <p className="text-xs text-slate-500">Separate email addresses with commas</p>
            <Input
              value={emails}
              onChange={(e) => setEmails(e.target.value)}
              className="border-slate-200 bg-white shadow-xs"
              autoComplete="email"
            />
          </div>

          <div className="space-y-1.5">
            <ReportModalFieldLabel>Subject</ReportModalFieldLabel>
            <Input
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              className="border-slate-200 bg-white shadow-xs"
            />
          </div>

          <div className="space-y-1.5">
            <ReportModalFieldLabel>Message</ReportModalFieldLabel>
            <Textarea
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              className="min-h-[100px] resize-y border-slate-200 bg-white shadow-xs"
            />
          </div>

          <div className="space-y-1.5">
            <ReportModalFieldLabel>File type</ReportModalFieldLabel>
            <ReportFileTypeSelect value={fileType} onChange={setFileType} />
          </div>
        </div>

        <DialogFooter className="gap-2 border-t border-slate-100 px-6 py-4 sm:justify-end">
          <Button type="button" variant="outline" className="border-slate-200 bg-white" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="button" variant="outline" className="border-slate-200 bg-white">
            Send preview
          </Button>
          <Button
            type="button"
            className="bg-sky-400 text-white hover:bg-sky-500"
            onClick={handleSend}
            disabled={sending}
          >
            {sending ? "Sending…" : "Send"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

