import { fileURLToPath } from "url"
import { dirname } from "path"

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

const backendBase = (process.env.NEXT_PUBLIC_API_URL || "http://localhost:5712").replace(/\/$/, "")

/** @type {import('next').NextConfig} */
const nextConfig = {
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
    return [{ source: "/api/:path*", destination: `${backendBase}/api/:path*` }]
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
