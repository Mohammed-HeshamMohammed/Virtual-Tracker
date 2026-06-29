import { ImageResponse } from "next/og"
import fs from "node:fs"
import path from "node:path"

export const size = { width: 1200, height: 630 }
export const contentType = "image/png"

export default function Image() {
  let logoDataUrl = ""
  try {
    const filePath = path.join(process.cwd(), "public/stopwatch-green.png")
    const fileBuffer = fs.readFileSync(filePath)
    logoDataUrl = `data:image/png;base64,${fileBuffer.toString("base64")}`
  } catch (err) {
    console.error("Failed to load opengraph logo:", err)
  }

  return new ImageResponse(
    (
      <div
        style={{
          height: "100%",
          width: "100%",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          background: "linear-gradient(135deg, #0f172a 0%, #1e1b4b 100%)",
          color: "white",
          padding: 60,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 24, marginBottom: 20 }}>
          {logoDataUrl && (
            <img
              src={logoDataUrl}
              width="120"
              height="120"
              style={{ borderRadius: 24 }}
            />
          )}
          <div style={{ display: "flex", flexDirection: "column" }}>
            <div style={{ fontSize: 54, fontWeight: 800, letterSpacing: "-0.02em" }}>Virtual Tracker</div>
            <div style={{ fontSize: 24, color: "#a78bfa", fontWeight: 500, marginTop: 4 }}>Workforce Productivity Platform</div>
          </div>
        </div>
        <div style={{ fontSize: 32, fontWeight: 600, color: "#94a3b8", textAlign: "center", marginTop: 10 }}>
          Precise Time Tracking & Workforce Productivity Suite
        </div>
      </div>
    ),
    {
      ...size,
    }
  )
}
