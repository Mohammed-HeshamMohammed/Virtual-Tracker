// HTTP error page copy + actions by status code.

export type HttpErrorActionKind = "home" | "retry" | "reload" | "back"

export type HttpErrorDefinition = {
  status: number
  title: string
  headline: string
  description: string
  primaryAction: HttpErrorActionKind
  primaryLabel: string
  secondaryAction?: HttpErrorActionKind
  secondaryLabel?: string
  showDiagnostics: boolean
  /** Use the maintenance illustration instead of the status icon. */
  useMaintenanceImage?: boolean
}

const DEFAULT_SERVER_ERROR: HttpErrorDefinition = {
  status: 500,
  title: "Internal Server Error",
  headline: "Something Went Wrong",
  description:
    "Something went wrong on our end. Please try again in a few moments.",
  primaryAction: "retry",
  primaryLabel: "Try Again",
  secondaryAction: "home",
  secondaryLabel: "Go to Home",
  showDiagnostics: true,
}

/** Status code → error screen definition. */
export const HTTP_ERROR_CATALOG: Record<number, HttpErrorDefinition> = {
  400: {
    status: 400,
    title: "Bad Request",
    headline: "Invalid Request",
    description: "The request could not be understood or was missing required information. Check your input and try again.",
    primaryAction: "back",
    primaryLabel: "Go Back",
    secondaryAction: "home",
    secondaryLabel: "Go to Home",
    showDiagnostics: true,
  },
  401: {
    status: 401,
    title: "Unauthorized",
    headline: "Sign-In Required",
    description: "Your session may have expired or you are not signed in. Sign in again to continue.",
    primaryAction: "home",
    primaryLabel: "Go to Sign In",
    showDiagnostics: false,
  },
  403: {
    status: 403,
    title: "Forbidden",
    headline: "Access Denied",
    description: "You do not have permission to view this resource. Contact your administrator if you believe this is a mistake.",
    primaryAction: "home",
    primaryLabel: "Go to Home",
    secondaryAction: "back",
    secondaryLabel: "Go Back",
    showDiagnostics: false,
  },
  404: {
    status: 404,
    title: "Not Found",
    headline: "Page Not Found",
    description: "The page you are looking for does not exist, was moved, or the link is outdated.",
    primaryAction: "home",
    primaryLabel: "Go to Home",
    secondaryAction: "back",
    secondaryLabel: "Go Back",
    showDiagnostics: false,
  },
  408: {
    status: 408,
    title: "Request Timeout",
    headline: "Request Timed Out",
    description: "This is taking longer than expected. Please try again.",
    primaryAction: "retry",
    primaryLabel: "Try Again",
    secondaryAction: "home",
    secondaryLabel: "Go to Home",
    showDiagnostics: true,
  },
  409: {
    status: 409,
    title: "Conflict",
    headline: "Action Conflict",
    description: "This action conflicts with the current state of the resource. Refresh the page and try again.",
    primaryAction: "reload",
    primaryLabel: "Refresh Page",
    secondaryAction: "home",
    secondaryLabel: "Go to Home",
    showDiagnostics: true,
  },
  413: {
    status: 413,
    title: "Payload Too Large",
    headline: "Upload Too Large",
    description: "The file or data you sent exceeds the allowed size. Reduce the size and try again.",
    primaryAction: "back",
    primaryLabel: "Go Back",
    showDiagnostics: false,
  },
  422: {
    status: 422,
    title: "Unprocessable Entity",
    headline: "Validation Failed",
    description: "Some of the information provided is invalid. Review the form and correct any highlighted fields.",
    primaryAction: "back",
    primaryLabel: "Go Back",
    showDiagnostics: true,
  },
  429: {
    status: 429,
    title: "Too Many Requests",
    headline: "Slow Down",
    description: "You have made too many requests in a short period. Wait a moment, then try again.",
    primaryAction: "retry",
    primaryLabel: "Try Again",
    secondaryAction: "home",
    secondaryLabel: "Go to Home",
    showDiagnostics: false,
  },
  500: DEFAULT_SERVER_ERROR,
  502: {
    status: 502,
    title: "Bad Gateway",
    headline: "Gateway Error",
    description: "We're having trouble completing your request right now. Please try again shortly.",
    primaryAction: "retry",
    primaryLabel: "Try Again",
    secondaryAction: "home",
    secondaryLabel: "Go to Home",
    showDiagnostics: true,
  },
  503: {
    status: 503,
    title: "Service Unavailable",
    headline: "Service Unavailable",
    description:
      "We're having trouble connecting you right now. The service may be temporarily offline for maintenance or experiencing high demand.",
    primaryAction: "reload",
    primaryLabel: "Try Again",
    showDiagnostics: true,
    useMaintenanceImage: true,
  },
  504: {
    status: 504,
    title: "Gateway Timeout",
    headline: "Gateway Timed Out",
    description: "A required service did not respond in time. Please try again shortly.",
    primaryAction: "retry",
    primaryLabel: "Try Again",
    secondaryAction: "home",
    secondaryLabel: "Go to Home",
    showDiagnostics: true,
  },
}

export const HTTP_ERROR_PAGE_CODES = Object.keys(HTTP_ERROR_CATALOG)
  .map((code) => Number.parseInt(code, 10))
  .sort((a, b) => a - b)

export function normalizeHttpErrorCode(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.trunc(value)
  }
  if (typeof value === "string" && value.trim()) {
    const parsed = Number.parseInt(value.trim(), 10)
    if (Number.isFinite(parsed)) return parsed
  }
  return 500
}

export function getHttpErrorDefinition(status: number): HttpErrorDefinition {
  const normalized = normalizeHttpErrorCode(status)
  if (HTTP_ERROR_CATALOG[normalized]) {
    return HTTP_ERROR_CATALOG[normalized]
  }
  if (normalized >= 500) {
    return { ...DEFAULT_SERVER_ERROR, status: normalized, title: `Error ${normalized}` }
  }
  if (normalized >= 400) {
    return {
      status: normalized,
      title: `Error ${normalized}`,
      headline: "Request Could Not Be Completed",
      description: "The request failed with an unexpected client error. Go back and try again.",
      primaryAction: "back",
      primaryLabel: "Go Back",
      secondaryAction: "home",
      secondaryLabel: "Go to Home",
      showDiagnostics: true,
    }
  }
  return DEFAULT_SERVER_ERROR
}

export function isSupportedHttpErrorPageCode(code: number): boolean {
  return code in HTTP_ERROR_CATALOG
}
