import { defineConfig } from "@playwright/test";

// Smoke tests against the static production build (`npm run build` first).
// Uses the installed Chrome, so no browser download is needed.
// For the beta build: E2E_BASE=/beta E2E_SERVE_DIR=<folder with the build in beta/> (see .github/workflows/deploy.yml).
const base = process.env.E2E_BASE ?? "";
const url = `http://localhost:4173${base}/`;
export default defineConfig({
  testDir: "e2e",
  timeout: 90_000,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL: url,
    channel: "chrome",
    viewport: { width: 1280, height: 760 },
    // use the GPU when there is one; CI runners without a GPU fall back to SwiftShader on their own
    launchOptions: { args: ["--enable-unsafe-swiftshader", "--ignore-gpu-blocklist", "--autoplay-policy=no-user-gesture-required"] },
  },
  webServer: {
    command: `npx serve ${process.env.E2E_SERVE_DIR ?? "out"} -l 4173 --no-clipboard`,
    url,
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
});
