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
    if (process.env.NODE_ENV !== "development") {
      // Same-origin mode (NEXT_PUBLIC_API_SAME_ORIGIN=true): the browser only
      // talks to this host, and this server forwards /api/* to the backends.
      // Rewrite destinations are baked in at build time, so the backend URLs
      // below must be available as build variables.
      if (process.env.NEXT_PUBLIC_API_SAME_ORIGIN !== "true") return []
      const authBase = (gatewayBase || process.env.NEXT_PUBLIC_AUTH_API_URL || "").trim().replace(/\/$/, "")
      const dashboardBase = (gatewayBase || process.env.NEXT_PUBLIC_DASHBOARD_API_URL || "").trim().replace(/\/$/, "")
      if (!authBase || !dashboardBase) {
        throw new Error(
          "NEXT_PUBLIC_API_SAME_ORIGIN=true needs NEXT_PUBLIC_API_URL, or both NEXT_PUBLIC_AUTH_API_URL and NEXT_PUBLIC_DASHBOARD_API_URL, at build time.",
        )
      }
      // Keep in sync with AUTHN_EXACT in infrastructure/api/api-backend-routes.ts.
      const authnPaths = [
        "firebase-config",
        "readiness",
        "password-policy",
        "validate-password",
        "verify",
        "resolve-sign-in-methods",
        "google/start",
        "google/callback",
      ]
      return [
        ...authnPaths.flatMap((segment) => [
          { source: `/api/auth/${segment}`, destination: `${authBase}/api/auth/${segment}` },
          { source: `/api/v1/auth/${segment}`, destination: `${authBase}/api/v1/auth/${segment}` },
        ]),
        { source: "/api/:path*", destination: `${dashboardBase}/api/:path*` },
      ]
    }

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
