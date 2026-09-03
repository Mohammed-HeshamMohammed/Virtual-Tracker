"use client"

import { useState, useRef, useEffect } from "react"
import { createPortal } from "react-dom"
import { motion } from "framer-motion"
import { ChevronDown, Check, Search, X, Info } from "lucide-react"
import { cn } from "@/shared/utils/utils"

export function SimpleDropdown({ value, options, onChange, placeholder, searchable = false }: {
  value: string
  options: string[]
  onChange: (v: string) => void
  placeholder?: string
  searchable?: boolean
}) {
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState("")
  const [rect, setRect] = useState<DOMRect | null>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const dropdownRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const h = (e: MouseEvent) => {
      if (
        dropdownRef.current && !dropdownRef.current.contains(e.target as Node) &&
        triggerRef.current && !triggerRef.current.contains(e.target as Node)
      ) setOpen(false)
    }
    document.addEventListener("mousedown", h)
    return () => document.removeEventListener("mousedown", h)
  }, [])

  useEffect(() => {
    if (!open) return
    const update = () => {
      if (triggerRef.current) setRect(triggerRef.current.getBoundingClientRect())
    }
    update()
    window.addEventListener("scroll", update, true)
    window.addEventListener("resize", update)
    return () => {
      window.removeEventListener("scroll", update, true)
      window.removeEventListener("resize", update)
    }
  }, [open])

  const handleOpen = () => {
    if (triggerRef.current) setRect(triggerRef.current.getBoundingClientRect())
    setOpen(p => !p)
  }

  const filtered = searchable
    ? options.filter(o => o.toLowerCase().includes(q.toLowerCase()))
    : options

  return (
    <div className="relative">
      <button
        ref={triggerRef}
        onClick={handleOpen}
        className={cn(
          "flex items-center justify-between gap-2 px-3 py-2 border rounded-lg text-sm w-full bg-white transition-colors",
          open ? "border-blue-400 ring-1 ring-blue-400" : "border-slate-200 hover:border-slate-300"
        )} type="button"
      >
        <span className={value ? "text-slate-700" : "text-slate-400"}>{value || placeholder || "Select"}</span>
        <ChevronDown className={cn("w-4 h-4 text-slate-400 shrink-0 transition-transform", open && "rotate-180")} />
      </button>

      {open && rect && createPortal(
        <motion.div
          ref={dropdownRef}
          initial={{ opacity: 0, y: -4 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.1 }}
          style={{
            position: "fixed",
            top: rect.bottom + 4,
            left: rect.left,
            minWidth: rect.width,
            width: "max-content",
            zIndex: 9999,
          }}
          className="bg-white rounded-xl border border-slate-200 shadow-lg max-h-56 flex flex-col"
        >
          {searchable && (
            <div className="p-2 border-b border-slate-100 shrink-0">
              <div className="flex items-center gap-2 px-2 py-1.5 border border-blue-400 rounded-lg ring-1 ring-blue-400">
                <Search className="w-3.5 h-3.5 text-slate-400" />
                <input value={q} onChange={e => setQ(e.target.value)}
                  placeholder="Search Items" className="flex-1 text-sm outline-none bg-transparent" aria-label="Interactive control"
                />
              </div>
            </div>
          )}
          <div className="overflow-y-auto scrollbar-none [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none]">
            {searchable && (
              <button
                onClick={() => { onChange(""); setOpen(false) }}
                className="w-full text-left px-3 py-2 text-sm text-blue-500 hover:bg-slate-50" type="button"
              >
                Unselect
              </button>
            )}
            {filtered.map(opt => (
              <button
                key={opt}
                onClick={() => { onChange(opt); setOpen(false); setQ("") }}
                className={cn(
                  "w-full flex items-center justify-between text-left px-3 py-2.5 text-sm transition-colors",
                  opt === value ? "bg-blue-500 text-white" : "text-slate-700 hover:bg-slate-50"
                )} type="button"
              >
                {opt}
                {opt === value && <Check className="w-3.5 h-3.5" />}
              </button>
            ))}
            <div className="h-2 shrink-0" />
          </div>
        </motion.div>,
        document.body
      )}
    </div>
  )
}

export function Tip({ text, preferLeft }: { text: string; preferLeft?: boolean }) {
  const [pos, setPos] = useState<{ top: number; left?: number; right?: number } | null>(null)
  const iconRef = useRef<HTMLDivElement>(null)

  const show = () => {
    if (!iconRef.current) return
    const rect = iconRef.current.getBoundingClientRect()
    const tipWidth = 208
    const spaceRight = window.innerWidth - rect.right
    if (preferLeft || spaceRight >= tipWidth + 12) {
      setPos({ top: rect.top + rect.height / 2, left: rect.right + 8 })
    } else {
      setPos({ top: rect.top + rect.height / 2, right: window.innerWidth - rect.left + 8 })
    }
  }

  return (
    <div ref={iconRef} className="inline-flex items-center" onMouseEnter={show} onMouseLeave={() => setPos(null)}>
      <Info className="w-3.5 h-3.5 text-slate-400 cursor-help" />
      {pos && createPortal(
        <div
          style={{
            position: "fixed",
            top: pos.top,
            ...(pos.left !== undefined ? { left: pos.left } : { right: pos.right }),
            transform: "translateY(-50%)",
            zIndex: 9999,
            width: "13rem",
          }}
          className="bg-slate-800 text-white text-xs rounded-lg px-3 py-2 shadow-lg leading-relaxed pointer-events-none"
        >
          {text}
        </div>,
        document.body
      )}
    </div>
  )
}

export function Toggle({ checked, onChange, disabled }: {
  checked: boolean
  onChange: () => void
  disabled?: boolean
}) {
  return (
    <button
      onClick={onChange} disabled={disabled}
      className={cn(
        "relative inline-flex h-5 w-9 shrink-0 rounded-full border-2 border-transparent transition-colors",
        checked ? "bg-blue-500" : "bg-slate-200",
        disabled && "opacity-40 cursor-not-allowed"
      )} type="button"
    >
      <span className={cn(
        "inline-block h-4 w-4 rounded-full bg-white shadow-sm transform transition-transform",
        checked ? "translate-x-4" : "translate-x-0"
      )} />
    </button>
  )
}

export function ReferralModal({ onClose }: { onClose: () => void }) {
  const [email, setEmail] = useState("")
  const [copied, setCopied] = useState(false)
  const referralLink = "https://app.hubstaff.com/signup?referral_code=3139934_TWm7Vtw"

  const copy = () => {
    try {
      navigator.clipboard.writeText(referralLink)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch (err) {
      console.error("Clipboard write failed:", err)
    }
  }

  return (
    <motion.div
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-6"
      onClick={onClose}
    >
      <motion.div
        initial={{ scale: 0.96, y: 8 }} animate={{ scale: 1, y: 0 }} exit={{ scale: 0.96 }}
        transition={{ duration: 0.18 }}
        className="bg-white rounded-2xl w-full max-w-md shadow-2xl p-7 relative"
        onClick={e => e.stopPropagation()}
      >
        <button onClick={onClose} className="absolute top-4 right-4 p-1 hover:bg-slate-100 rounded-lg" type="button">
          <X className="w-4 h-4 text-slate-400" />
        </button>
        <h2 className="text-lg font-bold text-slate-800 text-center mb-2">
          Refer companies to Hubstaff and earn a $300 cash bonus.
        </h2>
        <p className="text-sm text-slate-500 text-center mb-5">
          Receive a $300 gift card when you refer someone to Hubstaff who creates a new organization
          and subscribes to a paid annual plan with at least 5 seats.
        </p>
        <input
          value={email} onChange={e => setEmail(e.target.value)} placeholder="Email address"
          className="w-full px-3 py-2.5 border border-slate-200 rounded-lg text-sm mb-3 focus:outline-none focus:border-blue-400 focus:ring-1 focus:ring-blue-400"
        />
        <button className="w-full py-2.5 bg-blue-400 hover:bg-blue-500 text-white text-sm font-semibold rounded-lg transition-colors mb-5" type="button">
          Send invite
        </button>
        <div>
          <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1.5">Your Referral Link</p>
          <div className="flex items-center gap-2 px-3 py-2 border border-slate-200 rounded-lg">
            <span className="text-xs text-slate-500 flex-1 truncate">{referralLink}</span>
            <button onClick={copy} className="text-xs text-blue-500 font-medium shrink-0 hover:text-blue-600" type="button">
              {copied ? "Copied!" : "Copy link"}
            </button>
          </div>
        </div>
        <p className="text-xs text-blue-500 text-center mt-4 hover:underline cursor-pointer">Terms and Conditions</p>
      </motion.div>
    </motion.div>
  )
}

export const inputCls = "w-full px-3 py-2.5 border border-slate-200 rounded-lg text-sm text-slate-700 placeholder:text-slate-400 focus:outline-none focus:border-blue-400 focus:ring-1 focus:ring-blue-400 transition-colors"
export const labelCls = "text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1.5 block"

