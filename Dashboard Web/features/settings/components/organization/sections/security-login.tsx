/* eslint-disable react-doctor/use-lazy-motion */
"use client"

import { useState } from "react"
import { motion, AnimatePresence } from "framer-motion"
import { X } from "lucide-react"
import { cn } from "@/shared/utils/utils"
import { useTheme } from "@/shared/providers/app"
import { Toggle, Segment, Label } from "@/features/settings/components/organization/components/ui"
import { SECURITY_LOGIN_NAV, type SecurityNavKey } from "@/features/settings/components/shared/constants"

export default function SecurityLogin() {
  const { isDark } = useTheme()
  const [active, setActive] = useState<"sso" | "2fa">("2fa")
  const [scim, setScim] = useState(false)
  const [banner, setBanner] = useState(true)

  return (
    <div className="flex flex-col md:flex-row w-full min-h-[400px]">
      <div className={cn("w-full md:w-64 md:border-r py-4 md:pr-4 space-y-0.5", isDark ? "border-white/5" : "border-slate-100")}>
        {SECURITY_LOGIN_NAV.map(i => (
          <button key={i.k} onClick={() => setActive(i.k as any)} className={cn("w-full text-left text-sm py-2 px-3 transition-colors",
            active === i.k
              ? "text-[#006e2f] font-semibold border-l-2 border-[#006e2f]"
              : isDark ? "text-white/40 hover:text-white/70" : "text-slate-500 hover:text-slate-700"
          )} type="button">
            {i.l}{i.premium && <span className="text-amber-400 ml-1">★</span>}
          </button>
        ))}
      </div>
      <div className="flex-1 py-4 md:pl-8">
        <AnimatePresence mode="wait">
          {active === "2fa" ? (
            <motion.div key="2fa" initial={{ opacity: 0, x: 8 }} animate={{ opacity: 1, x: 0 }} className="space-y-4 w-full">
              <Label label="Require Two-Factor Authentication" info="Requires users to enter a code from their phone on untrusted devices." isDark={isDark} />
              <p className={cn("text-sm", isDark ? "text-white/40" : "text-slate-500")}>Two-factor authentication adds an extra layer of security to your account login.</p>
              <Segment options={["Not required", "Required"]} value="Not required" onChange={() => { }} isDark={isDark} />
            </motion.div>
          ) : (
            <motion.div key="sso" initial={{ opacity: 0, x: 8 }} animate={{ opacity: 1, x: 0 }} className="space-y-6 w-full">
              {banner && (
                <div className={cn("flex items-center justify-between rounded-xl px-4 py-3 border", isDark ? "bg-blue-500/10 border-blue-500/20" : "bg-blue-50 border-blue-100")}>
                  <p className={cn("text-sm", isDark ? "text-blue-300" : "text-blue-700")}>Enterprise plan required for SSO. Upgrade to enable.</p>
                  <div className="flex items-center gap-2">
                    <button className="px-4 py-1.5 text-xs font-semibold bg-blue-600 text-white rounded-lg" type="button">Upgrade</button>
                    <button onClick={() => setBanner(false)} type="button"><X className={cn("w-4 h-4", isDark ? "text-blue-400/60" : "text-blue-400")} /></button>
                  </div>
                </div>
              )}
              <div><Label label="Single Sign-On" isDark={isDark} /><button className="px-5 py-2 text-sm font-semibold bg-blue-500 text-white rounded-lg" type="button">Configure SSO</button></div>
              <div className={cn("border-t pt-5 flex items-start gap-3", isDark ? "border-white/5" : "border-slate-100")}>
                <Toggle checked={scim} onChange={() => setScim(!scim)} />
                <div>
                  <Label label="Enable SCIM" info="Automate user provisioning through your IdP." isDark={isDark} />
                  <p className={cn("text-xs", isDark ? "text-white/30" : "text-slate-400")}>Automate user management with your identity provider.</p>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  )
}

