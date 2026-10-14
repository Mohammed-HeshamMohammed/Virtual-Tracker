"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { fetchPdfSettings, savePdfSettings } from "@/features/reports/api/pdf-settings-api"
import { appearanceOf, DEFAULT_PDF_OPTIONS, normalizePdfOptions, type PdfOptions } from "@/shared/pdf-core/options"

const STORAGE_KEY = "reports:pdf-options:v1"
const SAVE_DELAY_MS = 800

function readLocal(): Partial<PdfOptions> | null {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    return raw ? (JSON.parse(raw) as Partial<PdfOptions>) : null
  } catch {
    return null
  }
}

function writeLocal(settings: Partial<PdfOptions>) {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(settings))
  } catch {
    // Not remembering here is fine; the server still has it.
  }
}

// Only how documents look is remembered - not whose pay slip, or which projects.
function withDefaults(saved: Partial<PdfOptions> | null): PdfOptions {
  return saved ? normalizePdfOptions({ ...DEFAULT_PDF_OPTIONS, ...saved }) : DEFAULT_PDF_OPTIONS
}

/**
 * The PDF settings (template, language, formats, header note, logo and the
 * show/hide switches), kept on the server per member so they follow the user
 * across devices. This browser's copy paints them instantly and covers the
 * server being unreachable; settings saved here before the server held any
 * are uploaded once. Read after mount so the first render matches the server's.
 */
export function usePdfOptions(): [PdfOptions, (next: PdfOptions | ((prev: PdfOptions) => PdfOptions)) => void] {
  const [options, setOptions] = useState<PdfOptions>(DEFAULT_PDF_OPTIONS)
  const touched = useRef(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pending = useRef<Partial<PdfOptions> | null>(null)

  const flush = useCallback(() => {
    if (timer.current) clearTimeout(timer.current)
    timer.current = null
    const settings = pending.current
    pending.current = null
    if (settings) void savePdfSettings(settings).catch(() => undefined)
  }, [])

  useEffect(() => {
    const local = readLocal()
    if (local) setOptions(withDefaults(local))
    let cancelled = false
    fetchPdfSettings()
      .then((remote) => {
        if (cancelled) return
        if (remote) {
          // Whatever the user changed while this was loading wins.
          if (touched.current) return
          writeLocal(remote)
          setOptions(withDefaults(remote))
        } else if (local && !touched.current) {
          void savePdfSettings(local).catch(() => undefined)
        }
      })
      .catch(() => undefined)
    return () => {
      cancelled = true
      flush()
    }
  }, [flush])

  const update = useCallback(
    (next: PdfOptions | ((prev: PdfOptions) => PdfOptions)) => {
      touched.current = true
      setOptions((prev) => {
        const resolved = normalizePdfOptions(typeof next === "function" ? next(prev) : next)
        const settings = appearanceOf(resolved)
        writeLocal(settings)
        pending.current = settings
        if (timer.current) clearTimeout(timer.current)
        timer.current = setTimeout(flush, SAVE_DELAY_MS)
        return resolved
      })
    },
    [flush],
  )

  return [options, update]
}
