import type { Metadata } from "next"
import { Inter } from "next/font/google"
import "@/styles/globals.css"
import CookieConsentBanner from "@/components/CookieConsentBanner"

const inter = Inter({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-sans",
})

export const metadata: Metadata = {
  metadataBase: new URL("https://virtualtracker.com"),
  title: {
    default: "My Virtual Tracker - Precise Time Tracking & Workforce Productivity Suite",
    template: "%s | My Virtual Tracker",
  },
  description: "Track hours, optimize workflows, and manage distributed teams transparently with My Virtual Tracker.",
  keywords: [
    "time tracking",
    "workforce productivity",
    "employee monitoring",
    "timesheets",
    "remote team management",
    "project tracking",
  ],
  applicationName: "My Virtual Tracker",
  alternates: {
    canonical: "/",
  },
  openGraph: {
    title: "My Virtual Tracker - Precise Time Tracking & Workforce Productivity Suite",
    description: "Track hours, optimize workflows, and manage distributed teams transparently with My Virtual Tracker.",
    url: "https://virtualtracker.com",
    siteName: "My Virtual Tracker",
    locale: "en_US",
    type: "website",
    images: [
      {
        url: "/stopwatch-green.png",
        width: 512,
        height: 512,
        alt: "My Virtual Tracker",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "My Virtual Tracker",
    description: "Track hours, optimize workflows, and manage distributed teams transparently with My Virtual Tracker.",
    images: ["/stopwatch-green.png"],
  },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      "max-video-preview": -1,
      "max-image-preview": "large",
      "max-snippet": -1,
    },
  },
  manifest: "/manifest.webmanifest",
  icons: {
    icon: "/stopwatch-green.png",
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
      <body className={`${inter.variable} font-sans antialiased bg-white text-slate-900`}>
        {children}
        <CookieConsentBanner />
      </body>
    </html>
  )
}
