import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

export default defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    // React Three Fiber's frame loop and the match engine are imperative by design:
    // useFrame mutates three.js objects, refs and the simulation every frame.
    files: ["src/game3d/**/*.{ts,tsx}", "src/ui/game/**/*.{ts,tsx}"],
    rules: { "react-hooks/immutability": "off", "react-hooks/purity": "off" },
  },
  globalIgnores([".next/**", "out/**", "node_modules/**", "next-env.d.ts", "scripts/blender/**", "public/sw.js"]),
]);
