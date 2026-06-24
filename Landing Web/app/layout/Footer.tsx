"use client"

const FOOTER_COLS = [
  {
    title: "Product & platform",
    links: ["Hour logging", "Output visibility", "Workforce signals", "Pay & invoicing", "Connected apps", "Smart timesheets", "Team visibility", "Custom reports", "Client invoicing"],
  },
  {
    title: "Company",
    links: ["About us", "Guiding principles", "Reviews", "Press", "Partners", "Status", "Product roadmap", "Careers"],
    badges: [{ label: "Hiring", index: 7 }],
  },
  {
    title: "Get Virtual Tracker",
    links: ["Download Virtual Tracker", "Mac time tracker", "Linux time tracker", "Windows time tracker", "Web Time Tracker"],
  },
  {
    title: "Connect with us",
    links: ["Help center", "Sign in", "Pricing", "Try Demo now", "Contact Us"],
    badges: [{ label: "Free trial", index: 2 }],
  },
  {
    title: "Compare Virtual Tracker with",
    links: ["Toggl", "Clockify", "Insightful", "Apploye", "ActivTrak", "Time Doctor", "Desktime", "See all comparisons"],
  },
  {
    title: "Resources",
    links: ["Resource hub", "Time tracking resources", "Virtual Tracker ROI calculator", "Virtual Tracker buy-in guide", "FAQ", "Customer stories", "Blog"],
  },
]

export default function Footer() {
  return (
    <footer className="py-12 px-4 md:px-8" style={{ background: "#151d2e" }}>
      <div className="w-full">
        <div style={{ display: "grid", gridTemplateColumns: "repeat(6, minmax(0, 1fr))", gap: "2rem" }}>
          {FOOTER_COLS.map((col) => (
            <div key={col.title} className="min-w-0">
              <div className="text-xs font-bold text-white mb-4">{col.title}</div>
              <ul className="space-y-2.5">
                {col.links.map((link, linkIdx) => {
                  const badge = col.badges?.find(b => b.index === linkIdx)
                  return (
                    <li key={link} className="flex items-center gap-2">
                      <a href="#" className="text-slate-400 hover:text-slate-200 text-sm transition-colors">{link}</a>
                      {badge && (
                        <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded text-white" style={{ background: badge.label === "Hiring" ? "#16a34a" : "#7c3aed" }}>
                          {badge.label}
                        </span>
                      )}
                    </li>
                  )
                })}
              </ul>
            </div>
          ))}
        </div>
      </div>
    </footer>
  )
}