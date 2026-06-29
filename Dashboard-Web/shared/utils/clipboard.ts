/**
 * Copies text to the clipboard. Returns false when the browser blocks access
 * (e.g. document not focused) instead of throwing.
 */
export async function copyTextToClipboard(text: string): Promise<boolean> {
  const value = text.trim()
  if (!value || typeof document === "undefined") return false

  if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
    try {
      if (typeof window !== "undefined" && document.hasFocus?.() === false) {
        window.focus()
      }
      await navigator.clipboard.writeText(value)
      return true
    } catch {
      // Fall through to legacy copy.
    }
  }

  try {
    const textarea = document.createElement("textarea")
    textarea.value = value
    textarea.setAttribute("readonly", "")
    textarea.style.position = "fixed"
    textarea.style.top = "0"
    textarea.style.left = "-9999px"
    document.body.appendChild(textarea)
    textarea.focus()
    textarea.select()
    const copied = document.execCommand("copy")
    document.body.removeChild(textarea)
    return copied
  } catch {
    return false
  }
}
