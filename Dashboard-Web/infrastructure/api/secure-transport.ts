
const LOCAL_API_HOST = /^(localhost|127\.0\.0\.1)$/i

export function getSecureApiBaseUrl(baseUrl: string): string {
  const trimmed = baseUrl.trim().replace(/\/$/, "")
  if (!trimmed) return trimmed

  if (process.env.NODE_ENV === "production" && trimmed.startsWith("http://")) {
    try {
      const { hostname } = new URL(trimmed)
      if (!LOCAL_API_HOST.test(hostname)) {
        throw new Error("API requests must use HTTPS in production.")
      }
    } catch (err) {
      if (err instanceof Error && err.message.includes("HTTPS")) throw err
      throw new Error("API requests must use HTTPS in production.")
    }
  }

  return trimmed
}

export function assertSecureFetchUrl(url: string): void {
  if (typeof window === "undefined") return
  if (process.env.NODE_ENV !== "production") return

  try {
    const parsed = new URL(url, window.location.origin)
    if (parsed.protocol !== "https:" && !LOCAL_API_HOST.test(parsed.hostname)) {
      throw new Error("Sensitive requests must use HTTPS.")
    }
  } catch (err) {
    if (err instanceof Error && err.message.includes("HTTPS")) {
      throw err
    }
  }
}
