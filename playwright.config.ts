import { defineConfig } from "@playwright/test";

// Smoke tests against the static production build (`npm run build` first).
// Uses the installed Chrome, so no browser download is needed.
export default defineConfig({
  testDir: "e2e",
  timeout: 90_000,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL: "http://localhost:4173",
    channel: "chrome",
    viewport: { width: 1280, height: 760 },
    // use the GPU when there is one; CI runners without a GPU fall back to SwiftShader on their own
    launchOptions: { args: ["--enable-unsafe-swiftshader", "--ignore-gpu-blocklist", "--autoplay-policy=no-user-gesture-required"] },
  },
  webServer: {
    command: "npx serve out -l 4173 --no-clipboard",
    url: "http://localhost:4173",
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
});
