"use client"

import { Component, type ErrorInfo, type ReactNode } from "react"
import Link from "next/link"

type ErrorBoundaryProps = {
  children: ReactNode
  /** Short label shown in the fallback (e.g. "navigation", "hero"). */
  section?: string
  fallback?: ReactNode
}

type ErrorBoundaryState = {
  hasError: boolean
}

export default class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { hasError: false }

  static getDerivedStateFromError(): ErrorBoundaryState {
    return { hasError: true }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    if (process.env.NODE_ENV !== "production") {
      console.error(`[Landing-Web${this.props.section ? `:${this.props.section}` : ""}]`, error, info.componentStack)
    }
  }

  render(): ReactNode {
    if (this.state.hasError) {
      if (this.props.fallback) return this.props.fallback

      const label = this.props.section ?? "section"

      return (
        <div
          role="alert"
          className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950"
        >
          <p className="font-semibold">This {label} could not be displayed.</p>
          <p className="mt-1 text-amber-900/80">The rest of the page is still available.</p>
          <Link href="/" className="mt-2 inline-block font-semibold text-violet-700 hover:text-violet-800">
            Return home
          </Link>
        </div>
      )
    }

    return this.props.children
  }
}
