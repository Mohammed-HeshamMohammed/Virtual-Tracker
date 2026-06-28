type PageIntroProps = {
  eyebrow: string
  title: string
  description: string
  children?: React.ReactNode
}

export default function PageIntro({ eyebrow, title, description, children }: PageIntroProps) {
  return (
    <div className="relative overflow-hidden bg-slate-50/40 border-b border-slate-100/80">
      {/* Visual grid pattern and mesh gradients */}
      <div className="pointer-events-none absolute inset-0 select-none overflow-hidden">
        <div className="absolute inset-0 bg-[linear-gradient(to_right,#e2e8f0_1px,transparent_1px),linear-gradient(to_bottom,#e2e8f0_1px,transparent_1px)] bg-[size:3rem_3rem] [mask-image:radial-gradient(ellipse_80%_60%_at_50%_0%,#000_80%,transparent_100%)] opacity-[0.5]" />
        <div className="absolute -top-48 -right-48 w-[400px] h-[400px] rounded-full bg-violet-400/20 blur-[120px] animate-pulse duration-10000" />
        <div className="absolute -top-48 -left-48 w-[400px] h-[400px] rounded-full bg-blue-400/15 blur-[100px]" />
      </div>

      <section className="relative mx-auto max-w-7xl px-6 pt-28 pb-16 sm:pt-32 sm:pb-20 lg:pt-36 lg:pb-24 lg:px-8">
        <div className="max-w-3xl space-y-5">
          <span className="inline-flex items-center rounded-full border border-violet-200/80 bg-violet-50/70 px-3.5 py-1 text-xs font-bold text-violet-700 uppercase tracking-wider backdrop-blur-sm shadow-sm">
            {eyebrow}
          </span>
          <h1 className="text-4xl font-extrabold tracking-tight text-slate-900 sm:text-5xl md:text-6xl bg-clip-text text-transparent bg-gradient-to-r from-slate-900 via-[#1e1b4b] to-[#7c3aed] leading-tight pb-1">
            {title}
          </h1>
          <p className="text-lg md:text-xl text-slate-600 leading-relaxed max-w-2xl font-light">
            {description}
          </p>
        </div>
        {children ? <div className="mt-8 relative z-10">{children}</div> : null}
      </section>
    </div>
  )
}
