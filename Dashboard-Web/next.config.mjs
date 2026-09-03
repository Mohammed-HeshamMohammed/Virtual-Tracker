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

    const authnPaths = [
      "firebase-config",
      "readiness",
      "password-policy",
      "validate-password",
      "verify",
      "resolve-sign-in-methods",
    ]
    const authRewrites = authnPaths.flatMap((segment) => [
      { source: `/api/auth/${segment}`, destination: `${authDevBase}/api/auth/${segment}` },
      { source: `/api/v1/auth/${segment}`, destination: `${authDevBase}/api/v1/auth/${segment}` },
    ])

    return [
      ...authRewrites,
      { source: "/api/:path*", destination: `${dashboardDevBase}/api/:path*` },
    ]
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "Cross-Origin-Opener-Policy", value: "same-origin-allow-popups" },
          {
            key: "Permissions-Policy",
            value: "loopback-network=(self), local-network=(self)",
          },
        ],
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
