export function SectionCard({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <div className={`bg-white rounded-3xl p-8 shadow-sm border border-slate-100 ${className}`}>{children}</div>
}
