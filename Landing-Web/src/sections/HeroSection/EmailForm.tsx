"use client"

export default function EmailForm() {
  return (
    <div className="flex items-center justify-center mb-4">
      <div className="flex items-center bg-white rounded-full overflow-hidden shadow-2xl shadow-black/40 w-full max-w-md">
        <input
          type="email"
          placeholder="Enter your work email"
          className="px-6 py-4 text-sm text-slate-700 placeholder-slate-400 outline-none bg-transparent flex-1 min-w-0"
        />
        <button className="m-1.5 px-6 py-3 rounded-full text-sm font-bold text-white whitespace-nowrap flex-shrink-0" style={{
          background: "linear-gradient(135deg, #7c3aed, #6d28d9)"
        }}>
          Create account
        </button>
      </div>
    </div>
  )
}
