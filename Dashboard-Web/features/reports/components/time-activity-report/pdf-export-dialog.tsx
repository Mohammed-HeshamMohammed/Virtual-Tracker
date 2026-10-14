"use client"

import { useEffect, useRef, useState as useComponentState } from "react"
import { Loader2 } from "lucide-react"
import { Button } from "@/shared/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/shared/ui/dialog"
import type { PdfOptions } from "@/shared/pdf-core/options"
import type { RenderedPdf } from "@/features/reports/api/time-and-activity-api"
import { PdfSettingsForm, type PdfSettingsFormProps } from "@/features/reports/components/time-activity-report/pdf-settings-form"

const PREVIEW_DELAY_MS = 350
/** The browser's PDF viewer reports "loaded" well before it has drawn the page, so a new
 *  PDF waits this long behind the old one before it goes on top. */
const DRAW_GRACE_MS = 1500

/**
 * Two frames that stay mounted: the one on show, and the one a newer PDF loads
 * into out of sight. Swapping which is on top - rather than replacing the
 * frame - is what keeps the old page visible until the new one has been drawn.
 */
interface Preview {
  slots: [string | null, string | null]
  active: 0 | 1
  error: string | null
  busy: boolean
}

const EMPTY_PREVIEW: Preview = { slots: [null, null], active: 0, error: null, busy: false }

/** Saves a file the page already holds, under its own name. */
function saveBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const link = document.createElement("a")
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  link.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 1000)
}

/**
 * Export to PDF: every choice on the left, the document as it will come out on
 * the right, redrawn as the choices change. The PDF is built by the server -
 * the preview and the download are the same document, and the same one an
 * emailed report is made of.
 */
export function PdfExportDialog({
  open,
  onOpenChange,
  options,
  onOptionsChange,
  render,
  formProps,
}: {
  open: boolean
  onOpenChange: (next: boolean) => void
  options: PdfOptions
  onOptionsChange: (next: PdfOptions) => void
  /** Has the server build the PDF for these choices. `preview` marks a redraw, which may reuse data loaded a moment ago. */
  render: (options: PdfOptions, mode: { preview: boolean }) => Promise<RenderedPdf>
  formProps: Omit<PdfSettingsFormProps, "value" | "onChange">
}) {
  const [preview, setPreview] = useComponentState<Preview>(EMPTY_PREVIEW)
  const [downloading, setDownloading] = useComponentState(false)
  const [downloadError, setDownloadError] = useComponentState<string | null>(null)
  const renderRef = useRef(render)
  renderRef.current = render

  useEffect(() => {
    if (!open) return
    let cancelled = false
    setPreview((p) => ({ ...p, busy: true, error: null }))
    const timer = window.setTimeout(async () => {
      try {
        const { blob } = await renderRef.current(options, { preview: true })
        if (cancelled) return
        const url = URL.createObjectURL(blob)
        setPreview((p) => {
          // Nothing on show yet: it goes straight in.
          if (!p.slots[p.active]) return { ...p, slots: p.active === 0 ? [url, null] : [null, url], error: null, busy: false }
          const other = p.active === 0 ? 1 : 0
          const slots: Preview["slots"] = [...p.slots]
          // Whatever was still loading in the back frame is never going to be shown.
          const stale = slots[other]
          if (stale) URL.revokeObjectURL(stale)
          slots[other] = url
          return { ...p, slots, error: null, busy: false }
        })
      } catch (e) {
        if (cancelled) return
        setPreview((p) => ({ ...p, busy: false, error: e instanceof Error ? e.message : "Could not build the preview." }))
      }
    }, PREVIEW_DELAY_MS)
    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
    // `render` is read through a ref so a new closure each render does not redraw the preview.
  }, [open, options, setPreview])

  useEffect(() => {
    if (open) return
    setPreview((p) => {
      for (const url of p.slots) if (url) URL.revokeObjectURL(url)
      return EMPTY_PREVIEW
    })
    setDownloadError(null)
  }, [open, setPreview, setDownloadError])

  // The back frame has loaded its PDF: after the grace period, put it on top
  // and let go of the old one. A newer PDF that replaced it in the meantime wins.
  function showSlot(index: 0 | 1) {
    const url = preview.slots[index]
    if (!url || index === preview.active) return
    window.setTimeout(() => {
      setPreview((p) => {
        if (index === p.active || p.slots[index] !== url) return p
        const slots: Preview["slots"] = [...p.slots]
        const old = slots[p.active]
        if (old) URL.revokeObjectURL(old)
        slots[p.active] = null
        return { ...p, slots, active: index }
      })
    }, DRAW_GRACE_MS)
  }

  const showing = preview.slots[preview.active]
  const loadingBehind = preview.slots[preview.active === 0 ? 1 : 0] !== null
  const updating = preview.busy || loadingBehind

  async function handleDownload() {
    setDownloadError(null)
    setDownloading(true)
    try {
      const { blob, filename } = await render(options, { preview: false })
      saveBlob(blob, filename)
      onOpenChange(false)
    } catch (e) {
      setDownloadError(e instanceof Error ? e.message : "Could not build the PDF.")
    } finally {
      setDownloading(false)
    }
  }

  const error = downloadError ?? preview.error

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        showCloseButton
        className="flex h-[min(92vh,820px)] w-full max-w-[calc(100%-2rem)] flex-col gap-0 overflow-hidden rounded-lg border-slate-200 p-0 dark:border-slate-700 sm:max-w-5xl"
      >
        <DialogHeader className="space-y-0 border-b border-slate-100 px-6 pb-4 pr-14 pt-6 text-left dark:border-slate-800">
          <DialogTitle className="text-base font-semibold text-slate-900 dark:text-slate-100">Export to PDF</DialogTitle>
          <DialogDescription className="sr-only">
            Choose the document, its design, language and formats, and check the preview before downloading.
          </DialogDescription>
        </DialogHeader>

        <div className="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-[minmax(0,400px)_minmax(0,1fr)]">
          <div className="min-h-0 overflow-y-auto border-b border-slate-100 px-6 py-5 scrollbar-hide dark:border-slate-800 lg:border-b-0 lg:border-r">
            <PdfSettingsForm {...formProps} value={options} onChange={onOptionsChange} />
          </div>

          <div className="relative hidden min-h-0 flex-col bg-slate-100 dark:bg-slate-950 lg:flex">
            {showing ? null : (
              <div className="flex h-full items-center justify-center px-6 text-center text-sm text-slate-500 dark:text-slate-400">
                {preview.error ? preview.error : "Preparing the preview…"}
              </div>
            )}
            {([0, 1] as const).map((index) => {
              const url = preview.slots[index]
              if (!url) return null
              const onTop = index === preview.active
              return (
                <iframe
                  key={index}
                  title={onTop ? "PDF preview" : "PDF preview (loading)"}
                  aria-hidden={!onTop}
                  src={`${url}#toolbar=0&navpanes=0&view=FitH`}
                  onLoad={() => showSlot(index)}
                  // Both stay fully opaque and mounted; the one on top simply covers the other.
                  className={onTop ? "absolute inset-0 z-10 h-full w-full border-0" : "pointer-events-none absolute inset-0 z-0 h-full w-full border-0"}
                />
              )
            })}
            {updating ? (
              <div className="pointer-events-none absolute right-3 top-3 z-20 flex items-center gap-1.5 rounded-full bg-white/90 px-2.5 py-1 text-xs text-slate-600 shadow dark:bg-slate-800/90 dark:text-slate-300">
                <Loader2 className="h-3 w-3 animate-spin" />
                Updating
              </div>
            ) : null}
          </div>
        </div>

        {error ? (
          <p className="border-t border-red-200 bg-red-50 px-6 py-2 text-sm text-red-700 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-400 lg:hidden">
            {error}
          </p>
        ) : null}

        <DialogFooter className="items-center gap-2 border-t border-slate-100 px-6 py-4 dark:border-slate-800 sm:justify-between">
          <p className="hidden text-xs text-slate-500 dark:text-slate-400 sm:block">Design, language and format choices are saved in this browser.</p>
          <div className="flex gap-2">
            <Button
              type="button"
              variant="outline"
              className="border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-900"
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button
              type="button"
              className="bg-sky-400 text-white hover:bg-sky-500 dark:bg-sky-500 dark:hover:bg-sky-600"
              onClick={handleDownload}
              disabled={downloading || Boolean(preview.error)}
            >
              {downloading ? "Building…" : "Download PDF"}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
