import { ImageResponse } from "next/og"

export const size = { width: 1200, height: 630 }
export const contentType = "image/png"

export default function Image() {
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
          background: "linear-gradient(135deg, #111827 0%, #7c3aed 100%)",
          color: "white",
          fontSize: 64,
          fontWeight: 700,
          padding: 60,
        }}
      >
        <div style={{ fontSize: 36, opacity: 0.9 }}>Virtual Tracker</div>
        <div style={{ marginTop: 16 }}>Track work. Improve visibility. Scale confidently.</div>
      </div>
    ),
    {
      width: 1200,
      height: 630,
    }
  )
}
