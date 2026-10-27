import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: { alias: { "@": path.resolve(import.meta.dirname, "src") } },
  // full-game simulations are slow on shared CI runners
  test: { include: ["src/**/*.test.ts"], testTimeout: 120_000 },
});
