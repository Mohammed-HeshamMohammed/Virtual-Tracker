import { fileURLToPath } from "url"
import { dirname, join } from "path"

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

/** @type {import('next').NextConfig} */
const nextConfig = {
  output: "standalone",
  // Monorepo: parent folder has another package-lock.json — pin tracing to this app.
  outputFileTracingRoot: join(__dirname),
  images: { unoptimized: true },
  compress: true,
  poweredByHeader: false,
  typescript: {
    ignoreBuildErrors: process.env.SKIP_TYPECHECK === "1",
  },
  async redirects() {
    return [
      { source: "/contact-us", destination: "/contact", permanent: true },
      { source: "/about-us", destination: "/about", permanent: true },
      { source: "/hour-logging", destination: "/time-tracking", permanent: true },
      { source: "/output-visibility", destination: "/activity-capture", permanent: true },
      { source: "/workforce-signals", destination: "/people-teams", permanent: true },
      { source: "/pay-invoicing", destination: "/projects-tasks", permanent: true },
      { source: "/connected-apps", destination: "/features", permanent: true },
      { source: "/download-virtual-tracker", destination: "/desktop-agent", permanent: true },
      { source: "/mac-time-tracker", destination: "/desktop-agent", permanent: true },
      { source: "/windows-time-tracker", destination: "/desktop-agent", permanent: true },
      { source: "/linux-time-tracker", destination: "/desktop-agent", permanent: true },
      { source: "/web-time-tracker", destination: "/time-tracking", permanent: true },
      { source: "/toggl", destination: "/features", permanent: true },
      { source: "/clockify", destination: "/features", permanent: true },
      { source: "/insightful", destination: "/features", permanent: true },
      { source: "/apploye", destination: "/features", permanent: true },
      { source: "/activtrak", destination: "/features", permanent: true },
      { source: "/time-doctor", destination: "/features", permanent: true },
      { source: "/desktime", destination: "/features", permanent: true },
      { source: "/see-all-comparisons", destination: "/features", permanent: true },
    ]
  },
}

export default nextConfig
