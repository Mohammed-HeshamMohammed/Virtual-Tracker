"use client"

import { createContext, useEffect, useState, use } from "react"

type Theme = "light" | "dark" | "system"

interface ThemeContextValue {
  theme: Theme
  setTheme: (t: Theme) => void
  isDark: boolean
}

const ThemeContext = createContext<ThemeContextValue>({
  theme: "system",
  setTheme: () => {},
  isDark: false,
})

export function useTheme() {
  return use(ThemeContext)
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setThemeState] = useState<Theme>("system")
  const [sysDark, setSysDark] = useState(false)

  useEffect(() => {
    try {
      const stored = localStorage.getItem("theme") as Theme | null
      if (stored === "light" || stored === "dark" || stored === "system") {
        setThemeState(stored)
      }
    } catch {}
  }, [])

  useEffect(() => {
    const mq = window.matchMedia("(prefers-color-scheme: dark)")
    setSysDark(mq.matches)
    const h = (e: MediaQueryListEvent) => setSysDark(e.matches)
    mq.addEventListener("change", h)
    return () => mq.removeEventListener("change", h)
  }, [])

  const isDark = theme === "dark" || (theme === "system" && sysDark)

  useEffect(() => {
    const root = document.documentElement
    root.classList.toggle("dark", isDark)
  }, [isDark])

  const setTheme = (t: Theme) => {
    try {
      localStorage.setItem("theme", t)
    } catch {}
    setThemeState(t)
  }

  return (
    <ThemeContext.Provider value={{ theme, setTheme, isDark }}>
      {children}
    </ThemeContext.Provider>
  )
}
