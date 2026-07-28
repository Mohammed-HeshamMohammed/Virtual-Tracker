export function SectionCard({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <div className={`bg-white/90 dark:bg-slate-900/90 rounded-3xl p-6 sm:p-8 shadow-sm border border-slate-200/80 dark:border-slate-800 backdrop-blur-xl transition-all ${className}`}>{children}</div>
}
