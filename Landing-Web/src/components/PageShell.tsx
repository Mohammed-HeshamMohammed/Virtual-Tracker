import ErrorBoundary from "@/components/ErrorBoundary"
import { Footer, NavigationBar } from "@/features/shared"

export default function PageShell({
  children,
  className = "",
}: {
  children: React.ReactNode
  className?: string
}) {
  return (
    <div className={`min-h-screen bg-white font-sans ${className}`} style={{ fontFamily: "'DM Sans', 'Segoe UI', sans-serif" }}>
      <ErrorBoundary
        section="navigation"
        fallback={
          <header className="fixed top-0 left-0 right-0 z-50 h-16 bg-white/95 border-b border-slate-200 px-6 flex items-center">
            <span className="font-bold text-lg text-slate-900">Virtual Tracker</span>
          </header>
        }
      >
        <NavigationBar />
      </ErrorBoundary>
      {/* Bottom padding clears the fixed mobile/tablet bottom nav (hidden at lg and up). */}
      <div className="pb-24 lg:pb-0">
        <ErrorBoundary section="page content">{children}</ErrorBoundary>
      </div>
      <ErrorBoundary section="footer">
        <Footer />
      </ErrorBoundary>
    </div>
  )
}
