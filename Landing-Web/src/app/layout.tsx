import type { Metadata } from "next"
import { Inter } from "next/font/google"
import "@/styles/globals.css"

const inter = Inter({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-sans",
})

export const metadata: Metadata = {
  metadataBase: new URL("https://virtualtracker.com"),
  title: {
    default: "Virtual Tracker - Precise Time Tracking & Workforce Productivity Suite",
    template: "%s | Virtual Tracker",
  },
  description: "Track hours, optimize workflows, and manage distributed teams transparently with Virtual Tracker.",
  keywords: [
    "time tracking",
    "workforce productivity",
    "employee monitoring",
    "timesheets",
    "remote team management",
    "project tracking",
  ],
  applicationName: "Virtual Tracker",
  alternates: {
    canonical: "/",
  },
  openGraph: {
    title: "Virtual Tracker - Precise Time Tracking & Workforce Productivity Suite",
    description: "Track hours, optimize workflows, and manage distributed teams transparently with Virtual Tracker.",
    url: "https://virtualtracker.com",
    siteName: "Virtual Tracker",
    locale: "en_US",
    type: "website",
    images: [
      {
        url: "/stopwatch-green.png",
        width: 512,
        height: 512,
        alt: "Virtual Tracker",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "Virtual Tracker",
    description: "Track hours, optimize workflows, and manage distributed teams transparently with Virtual Tracker.",
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
      </body>
    </html>
  )
}
