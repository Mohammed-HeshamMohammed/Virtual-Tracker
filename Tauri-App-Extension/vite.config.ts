import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const host = process.env.TAURI_DEV_HOST;

export default defineConfig(async () => ({
  plugins: [react()],

  // The Windows 7 build runs this page in WebView2 109 (Chromium 109). Vite 8 raised its
  // default target past that, so keep the targets Vite 7 used by default.
  build: {
    target: ["chrome107", "edge107", "firefox104", "safari16"],
  },

  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      ignored: ["**/src-tauri/**"],
    },
  },
}));
