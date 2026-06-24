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
      <NavigationBar />
      {children}
      <Footer />
    </div>
  )
}
