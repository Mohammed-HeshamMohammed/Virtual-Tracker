import { fileURLToPath } from "url"
import { dirname } from "path"

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

const gatewayBase = process.env.NEXT_PUBLIC_API_URL?.trim().replace(/\/$/, "")
const authDevBase = (process.env.NEXT_PUBLIC_AUTH_API_URL || "http://127.0.0.1:5712").replace(/\/$/, "")
const dashboardDevBase = (
  process.env.NEXT_PUBLIC_DASHBOARD_API_URL ||
  process.env.NEXT_PUBLIC_API_URL ||
  "http://127.0.0.1:5713"
).replace(/\/$/, "")

/** @type {import('next').NextConfig} */
const nextConfig = {
  output: "standalone",
  async redirects() {
    return [
      { source: "/dashboard", destination: "/", permanent: false },
      { source: "/complete-registration", destination: "/", permanent: false },
      { source: "/invite/:token", destination: "/?inviteToken=:token", permanent: false },
      { source: "/transfer/:token", destination: "/?transferToken=:token", permanent: false },
      { source: "/auth", destination: "/", permanent: false },
      { source: "/agent-auth", destination: "/", permanent: false },
    ]
  },
  async rewrites() {
    if (process.env.NODE_ENV !== "development") return []

    if (gatewayBase) {
      return [{ source: "/api/:path*", destination: `${gatewayBase}/api/:path*` }]
    }

    return [
      { source: "/api/auth/:path*", destination: `${authDevBase}/api/auth/:path*` },
      { source: "/api/v1/auth/:path*", destination: `${authDevBase}/api/v1/auth/:path*` },
      { source: "/api/public/invites/:path*", destination: `${authDevBase}/api/public/invites/:path*` },
      { source: "/api/invites/open-link", destination: `${authDevBase}/api/invites/open-link` },
      { source: "/api/members/preprovision", destination: `${authDevBase}/api/members/preprovision` },
      { source: "/api/members/validate-add", destination: `${authDevBase}/api/members/validate-add` },
      { source: "/api/member-onboarding/:path*", destination: `${authDevBase}/api/member-onboarding/:path*` },
      {
        source: "/api/invites/:id/resend",
        destination: `${authDevBase}/api/invites/:id/resend`,
      },
      {
        source: "/api/invites/:id/link",
        destination: `${authDevBase}/api/invites/:id/link`,
      },
      {
        source: "/api/invites/:id/renew",
        destination: `${authDevBase}/api/invites/:id/renew`,
      },
      { source: "/api/:path*", destination: `${dashboardDevBase}/api/:path*` },
    ]
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [{ key: "Cross-Origin-Opener-Policy", value: "same-origin-allow-popups" }],
      },
    ]
  },
  images: { unoptimized: true },
  compiler: {
    removeConsole: process.env.NODE_ENV === "production",
  },
  experimental: {
    optimizeCss: true,
    optimizePackageImports: ["lucide-react", "date-fns", "@radix-ui/react-icons", "framer-motion", "recharts"],
  },
  turbopack: { root: __dirname },
  compress: true,
  poweredByHeader: false,
}

export default nextConfig
