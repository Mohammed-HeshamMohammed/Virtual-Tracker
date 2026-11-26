import type { LiveBuzzMessage } from "@/features/auth/services/presence-ws"

/**
 * A buzz in its own browser window, on top, instead of inside the dashboard tab - the closest a
 * web page can get to the desktop tracker's buzz, which appears over everything.
 *
 * Browsers only let a page open a window by itself when the person has allowed pop-ups for the
 * site. Without that, window.open returns null and the caller falls back to the card in the tab
 * (see LivePokes), which explains how to allow them.
 *
 * The window is an about:blank page filled in from here with plain elements and text (never an
 * HTML string, so nothing in a name or message can become markup). It needs no route, no
 * sign-in and no second live connection. Every dashboard tab gets the same buzz, so they all open the same
 * named window: one buzz, one window.
 */

const WINDOW_NAME = "vt-buzz"
/** A nudge window closes itself after this long, like the card in the tab. */
const NUDGE_WINDOW_MS = 20_000
const NUDGE_WIDTH = 380
const NUDGE_HEIGHT = 190
/** Gap from the screen edge for a nudge window, roughly where an antivirus pop-up sits. */
const NUDGE_MARGIN = 24

type Geometry = { left: number; top: number; width: number; height: number }

function windowGeometry(buzz: LiveBuzzMessage): Geometry {
  const screenLeft = (window.screen as Screen & { availLeft?: number }).availLeft ?? 0
  const screenTop = (window.screen as Screen & { availTop?: number }).availTop ?? 0
  const screenWidth = window.screen.availWidth
  const screenHeight = window.screen.availHeight

  if (buzz.style === "bluescreen") {
    return { left: screenLeft, top: screenTop, width: screenWidth, height: screenHeight }
  }
  const right = buzz.corner.endsWith("right")
  const bottom = buzz.corner.startsWith("bottom")
  return {
    left: right ? screenLeft + screenWidth - NUDGE_WIDTH - NUDGE_MARGIN : screenLeft + NUDGE_MARGIN,
    top: bottom ? screenTop + screenHeight - NUDGE_HEIGHT - NUDGE_MARGIN : screenTop + NUDGE_MARGIN,
    width: NUDGE_WIDTH,
    height: NUDGE_HEIGHT,
  }
}

/** A new element in the buzz window, styled and with plain text only - never parsed as HTML. */
function el<K extends keyof HTMLElementTagNameMap>(
  doc: Document,
  tag: K,
  style: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = doc.createElement(tag)
  node.style.cssText = style
  if (text != null) node.textContent = text
  return node
}

const CLOSE_BUTTON_NUDGE =
  "margin-top:16px;border:1px solid #cbd5e1;background:#fff;color:#334155;border-radius:8px;padding:7px 14px;font:600 13px system-ui,sans-serif;cursor:pointer"
const CLOSE_BUTTON_BLUE =
  "margin-top:40px;width:fit-content;border:1px solid rgba(255,255,255,.7);background:transparent;color:#fff;border-radius:8px;padding:9px 18px;font:600 14px system-ui,sans-serif;cursor:pointer"

/** Fills the window's page with the buzz and returns its Close button. */
function render(doc: Document, buzz: LiveBuzzMessage): HTMLButtonElement {
  doc.title = `Buzz from ${buzz.from}`
  const body = doc.body ?? doc.documentElement.appendChild(doc.createElement("body"))
  body.replaceChildren()

  if (buzz.style === "bluescreen") {
    body.style.cssText = "margin:0;font-family:system-ui,'Segoe UI',sans-serif"
    const main = el(
      doc,
      "main",
      "min-height:100vh;box-sizing:border-box;padding:12vh 10vw;background:#0078d7;color:#fff;display:flex;flex-direction:column;justify-content:center",
    )
    main.setAttribute("role", "alertdialog")
    main.setAttribute("aria-label", `Buzz from ${buzz.from}`)
    const face = el(doc, "p", "margin:0;font-size:120px;font-weight:300;line-height:1", ":(")
    face.setAttribute("aria-hidden", "true")
    main.append(
      face,
      el(doc, "p", "margin:40px 0 0;max-width:46rem;font-size:26px;line-height:1.35", "Your PC ran into a problem and needs you to focus."),
      el(doc, "p", "margin:24px 0 0;max-width:46rem;font-size:21px;font-weight:600", buzz.message),
      el(doc, "p", "margin:24px 0 0;font-size:14px;opacity:.8", `Buzz from ${buzz.from}`),
    )
    const close = el(doc, "button", CLOSE_BUTTON_BLUE, "Close this buzz")
    close.type = "button"
    main.append(close)
    body.append(main)
    return close
  }

  body.style.cssText = "margin:0;padding:18px;font-family:system-ui,'Segoe UI',sans-serif;background:#fff"
  const main = el(doc, "main", "display:flex;gap:14px;align-items:flex-start")
  main.setAttribute("role", "alert")
  const icon = el(
    doc,
    "div",
    "flex:none;width:34px;height:34px;border-radius:10px;background:#fef3c7;color:#d97706;display:grid;place-items:center;font-size:18px",
    "⚡",
  )
  icon.setAttribute("aria-hidden", "true")
  const text = el(doc, "div", "min-width:0;flex:1")
  text.append(
    el(doc, "p", "margin:0;font-size:11px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:#64748b", `Buzz from ${buzz.from}`),
    el(doc, "p", "margin:6px 0 0;font-size:15px;font-weight:600;color:#0f172a;overflow-wrap:anywhere", buzz.message),
  )
  main.append(icon, text)
  const close = el(doc, "button", CLOSE_BUTTON_NUDGE, "Close this buzz")
  close.type = "button"
  body.append(main, close)
  return close
}

/**
 * Opens (or reuses) the buzz window and shows `buzz` in it. Returns false when the browser
 * blocked the window, so the caller can show the buzz in the tab instead.
 */
export function openBuzzWindow(buzz: LiveBuzzMessage): boolean {
  const geometry = windowGeometry(buzz)
  let popup: Window | null = null
  try {
    popup = window.open(
      "",
      WINDOW_NAME,
      `popup,left=${geometry.left},top=${geometry.top},width=${geometry.width},height=${geometry.height}`,
    )
  } catch {
    popup = null
  }
  if (!popup) return false

  try {
    const doc = popup.document
    const closeButton = render(doc, buzz)
    const close = () => popup?.close()
    closeButton.addEventListener("click", close)
    doc.onkeydown = (e) => {
      if (e.key === "Escape") close()
    }
    closeButton.focus()
    // A reused window may still have an earlier nudge's timer running, which would close this
    // buzz early.
    const timers = popup as Window & { __vtBuzzCloseTimer?: number }
    if (timers.__vtBuzzCloseTimer != null) popup.clearTimeout(timers.__vtBuzzCloseTimer)
    timers.__vtBuzzCloseTimer = buzz.style === "nudge" ? popup.setTimeout(close, NUDGE_WINDOW_MS) : undefined
    // A window still open from an earlier buzz keeps its old size and place (a nudge followed by
    // a blue screen), so set them again. Browsers allow this for a window the page opened.
    try {
      popup.moveTo(geometry.left, geometry.top)
      popup.resizeTo(geometry.width, geometry.height)
    } catch {
      /* not allowed here - the content still shows */
    }
    popup.focus()
    return true
  } catch {
    // The named window is held by something we cannot write to: treat it as blocked.
    try {
      popup.close()
    } catch {
      /* ignore */
    }
    return false
  }
}
