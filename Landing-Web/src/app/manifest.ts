import type { MetadataRoute } from "next"

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Virtual Tracker",
    short_name: "Virtual Tracker",
    description: "Precise time tracking and workforce productivity suite for modern teams.",
    start_url: "/",
    display: "standalone",
    background_color: "#ffffff",
    theme_color: "#7c3aed",
    icons: [
      {
        src: "/stopwatch-green.png",
        sizes: "512x512",
        type: "image/png",
      },
      {
        src: "/stopwatch-black.png",
        sizes: "512x512",
        type: "image/png",
      },
    ],
  }
}
