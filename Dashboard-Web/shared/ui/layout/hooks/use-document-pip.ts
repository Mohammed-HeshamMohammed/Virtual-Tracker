"use client"

import { useState, useEffect, useCallback } from "react"
import { flushSync } from "react-dom"

function getDocumentPip() {
  return (window as Window & {
    documentPictureInPicture?: {
      window?: Window
      requestWindow: (opts: Record<string, unknown>) => Promise<Window>
    }
  }).documentPictureInPicture
}

function isUnsupportedBrowser(): boolean {
  if (typeof window === "undefined" || !navigator) return false
  const ua = navigator.userAgent
  return ua.includes("OPR") || ua.includes("Opera") || ua.includes("Comet")
}

function preparePipDocument(pip: Window) {
  document.querySelectorAll("style").forEach((node) => {
    pip.document.head.appendChild(node.cloneNode(true))
  })
  document.querySelectorAll('link[rel="stylesheet"]').forEach((node) => {
    const href = (node as HTMLLinkElement).href
    if (!href) return
    const link = pip.document.createElement("link")
    link.rel = "stylesheet"
    link.href = href
    pip.document.head.appendChild(link)
  })

  pip.document.documentElement.style.margin = "0"
  pip.document.documentElement.style.padding = "0"
  pip.document.documentElement.style.height = "100%"
  pip.document.documentElement.style.background = "transparent"
  pip.document.body.style.margin = "0"
  pip.document.body.style.padding = "0"
  pip.document.body.style.overflow = "hidden"
  pip.document.body.style.height = "100%"
  pip.document.body.style.background = "transparent"

  const container = pip.document.createElement("div")
  container.style.width = "100%"
  container.style.height = "100%"
  pip.document.body.appendChild(container)
  return container
}

export function useDocumentPip() {
  const [showPopup, setShowPopup] = useState(false)
  const [pipWindow, setPipWindow] = useState<Window | null>(null)
  const [pipContainer, setPipContainer] = useState<HTMLElement | null>(null)
  const [pipNotice, setPipNotice] = useState<string | null>(null)

  useEffect(() => {
    if (isUnsupportedBrowser()) {
      setPipNotice(
        "Picture-in-Picture may not work in Opera GX or Comet. Use Chrome or Edge for the floating timer.",
      )
    }
  }, [])

  const closeTimerPopup = useCallback(() => {
    if (pipWindow && !pipWindow.closed) pipWindow.close()
    const dpp = getDocumentPip()
    if (dpp?.window && !dpp.window.closed) dpp.window.close()
    setPipWindow(null)
    setPipContainer(null)
    setShowPopup(false)
  }, [pipWindow])

  const isTimerPopupOpen = useCallback(() => {
    return Boolean(pipWindow && !pipWindow.closed)
  }, [pipWindow])

  const tryOpenDocumentPip = useCallback(async (): Promise<Window | null> => {
    const dpp = getDocumentPip()
    if (!dpp?.requestWindow) return null

    if (dpp.window && !dpp.window.closed) {
      dpp.window.close()
    }

    try {
      const pip = await dpp.requestWindow({
        width: 400,
        height: 100,
        disallowReturnToOpener: true,
      })

      pip.document.body.style.overflow = "hidden"
      pip.document.documentElement.style.overflow = "hidden"

      const container = preparePipDocument(pip)

      pip.addEventListener("pagehide", () => {
        setPipWindow(null)
        setPipContainer(null)
        setShowPopup(false)
      })

      flushSync(() => {
        setPipWindow(pip)
        setPipContainer(container)
        setShowPopup(true)
      })

      return pip
    } catch (err) {
      console.warn("Document PiP unavailable:", err)
      return null
    }
  }, [])

  const openTimerPopup = useCallback(async () => {
    if (isTimerPopupOpen()) return

    const pip = await tryOpenDocumentPip()
    if (pip) return

    setPipNotice(
      "Could not open the floating timer. Use Chrome or Edge and allow Picture-in-Picture for this site.",
    )
  }, [isTimerPopupOpen, tryOpenDocumentPip])

  return {
    showPopup,
    pipContainer,
    pipNotice,
    setPipNotice,
    isTimerPopupOpen,
    openTimerPopup,
    closeTimerPopup,
  }
}
