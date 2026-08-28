import { defineConfig } from "vitest/config";

// Separate from vite.config.ts on purpose - that one is tuned for `tauri
// dev`/`tauri build` (fixed port, strictPort, src-tauri watch-ignore) and
// none of that applies to running tests, so keeping this standalone avoids
// any risk of test config leaking into the app build or vice versa.
export default defineConfig({
  test: {
    environment: "jsdom",
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
  },
});
