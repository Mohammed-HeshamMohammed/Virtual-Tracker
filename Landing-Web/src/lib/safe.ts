
export function clampIndex(index: number, length: number): number {
  if (length <= 0) return 0
  if (!Number.isFinite(index) || index < 0) return 0
  if (index >= length) return length - 1
  return index
}

export function safeHref(href: string | null | undefined, fallback = "/"): string {
  const value = href?.trim()
  if (!value) return fallback
  if (value.startsWith("/") || value.startsWith("http://") || value.startsWith("https://")) {
    return value
  }
  return fallback
}

export function isValidRedirectUrl(url: string): boolean {
  try {
    const parsed = new URL(url)
    return parsed.protocol === "http:" || parsed.protocol === "https:"
  } catch {
    return false
  }
}
