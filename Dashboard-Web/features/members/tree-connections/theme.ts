export type ChartTheme = {
  canvas: string
  dots: string
  card: string
  cardHover: string
  border: string
  borderStrong: string
  text: string
  muted: string
  accent: string
  accentSoft: string
  link: string
  linkActive: string
  frame: string
  panel: string
  panelBorder: string
  danger: string
  dangerSoft: string
  warn: string
  shadow: string
}

export function chartTheme(isDark: boolean): ChartTheme {
  return isDark
    ? {
        canvas: "#0d1220",
        dots: "rgba(148,163,184,0.10)",
        card: "#171d30",
        cardHover: "#1d2540",
        border: "#2b3550",
        borderStrong: "#41507a",
        text: "#e4e9ff",
        muted: "#9aa7c4",
        accent: "#4be277",
        accentSoft: "rgba(75,226,119,0.14)",
        link: "#41507a",
        linkActive: "#4be277",
        frame: "rgba(148,163,184,0.06)",
        panel: "rgba(23,29,48,0.96)",
        panelBorder: "#2b3550",
        danger: "#f87171",
        dangerSoft: "rgba(248,113,113,0.16)",
        warn: "#fbbf24",
        shadow: "0 10px 30px rgba(0,0,0,0.45)",
      }
    : {
        canvas: "#f6f8fc",
        dots: "rgba(100,116,139,0.16)",
        card: "#ffffff",
        cardHover: "#f8fafc",
        border: "#dbe2ee",
        borderStrong: "#b6c2d9",
        text: "#0f172a",
        muted: "#64748b",
        accent: "#2563eb",
        accentSoft: "rgba(37,99,235,0.10)",
        link: "#b6c2d9",
        linkActive: "#2563eb",
        frame: "rgba(100,116,139,0.06)",
        panel: "rgba(255,255,255,0.97)",
        panelBorder: "#dbe2ee",
        danger: "#dc2626",
        dangerSoft: "rgba(220,38,38,0.10)",
        warn: "#d97706",
        shadow: "0 10px 30px rgba(15,23,42,0.14)",
      }
}
