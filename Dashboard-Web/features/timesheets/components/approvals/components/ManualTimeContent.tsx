"use client"

export function ManualTimeContent() {
  return (
    <div className="flex flex-col items-center justify-center py-12 text-center">
      <h2 className="text-2xl font-semibold text-slate-800 dark:text-slate-100 mb-4">Manual time</h2>
      <p className="text-sm text-slate-600 dark:text-slate-400 max-w-md mb-8 leading-relaxed">
        By enabling the manual time approval setting, your team can submit requests for manager approval when adding manual time. Managers can then review and approve time entries, ensuring accurate project tracking, payroll and compliance.
      </p>

      {/* Illustration */}
      <div className="relative mb-8">
        {/* Calendar base */}
        <div className="w-48 h-36 bg-blue-400 rounded-lg relative">
          {/* Calendar rings */}
          <div className="absolute -top-3 left-8 w-4 h-6 bg-slate-700 rounded-full" />
          <div className="absolute -top-3 right-8 w-4 h-6 bg-slate-700 rounded-full" />

          {/* Calendar grid lines */}
          <div className="absolute top-8 left-0 right-0 h-px bg-blue-300" />
          <div className="absolute top-16 left-0 right-0 h-px bg-blue-300" />
          <div className="absolute top-24 left-0 right-0 h-px bg-blue-300" />

          {/* X marks and blue squares */}
          <div className="absolute top-10 left-4 text-blue-200 text-lg">×</div>
          <div className="absolute top-10 left-16 w-6 h-6 bg-blue-300 rounded" />
          <div className="absolute top-10 right-16 text-blue-200 text-lg">×</div>
          <div className="absolute top-18 left-4 text-blue-200 text-lg">×</div>
          <div className="absolute top-18 right-8 w-6 h-6 bg-blue-300 rounded" />
          <div className="absolute top-26 left-16 text-blue-200 text-lg">×</div>
        </div>

        {/* Person illustration */}
        <div className="absolute -top-8 left-1/2 -translate-x-1/2">
          <div className="relative">
            {/* Head */}
            <div className="w-10 h-10 bg-amber-200 rounded-full mx-auto" />
            {/* Body */}
            <div className="w-12 h-16 bg-blue-500 rounded-lg mx-auto -mt-2" />
            {/* Legs */}
            <div className="flex justify-center gap-1 -mt-1">
              <div className="w-5 h-12 bg-slate-800 rounded-b-lg" />
              <div className="w-5 h-12 bg-slate-800 rounded-b-lg" />
            </div>
            {/* Laptop */}
            <div className="absolute top-8 left-1/2 -translate-x-1/2 w-14 h-10 bg-slate-700 rounded" />
          </div>
        </div>

        {/* Clock icon */}
        <div className="absolute -top-4 right-0 w-12 h-12 bg-blue-100 rounded-full flex items-center justify-center">
          <svg className="w-6 h-6 text-blue-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
        </div>
      </div>

      <button className="px-6 py-2.5 text-sm font-medium text-white bg-blue-500 rounded-lg hover:bg-blue-600 transition-colors">
        Set it up
      </button>
    </div>
  )
}
