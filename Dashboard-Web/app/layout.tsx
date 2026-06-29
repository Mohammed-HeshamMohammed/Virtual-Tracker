import type { Metadata } from "next"
import { Inter } from "next/font/google"
import "@/app/globals.css"
import { ThemeProvider, AuthProvider } from "@/shared/providers/app"
import { LauncherShell } from "@/app/launcher-shell"

const inter = Inter({
  subsets: ["latin"],
  display: "swap",
})

export const metadata: Metadata = {
  title: "Virtual Tracker - Time Tracking & Productivity",
  description: "Track time, monitor productivity, and manage your remote team with Virtual Tracker.",
  icons: {
    icon: [
      {
        url: "/stopwatch-black.png",
        media: "(prefers-color-scheme: light)",
      },
      {
        url: "/stopwatch-green.png",
        media: "(prefers-color-scheme: dark)",
      },
    ],
    apple: "/stopwatch-green.png",
  },
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="en">
      <body className={`${inter.className} font-sans antialiased`}>
        <ThemeProvider>
          <AuthProvider>
            <LauncherShell>{children}</LauncherShell>
          </AuthProvider>
        </ThemeProvider>
      </body>
    </html>
  )
}
