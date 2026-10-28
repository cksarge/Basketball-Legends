import type { NextConfig } from "next";
import pkg from "./package.json";

// BL_CHANNEL=beta builds the prerelease branch for legends.carterscoding.com/beta/
const beta = process.env.BL_CHANNEL === "beta";
const basePath = beta ? "/beta" : "";

const nextConfig: NextConfig = {
  output: "export",
  basePath,
  trailingSlash: true,
  images: { unoptimized: true },
  reactStrictMode: true,
  transpilePackages: ["three"],
  // version is shown in the main menu footer and links to /changelog; see src/lib/site.ts for the others
  env: { APP_VERSION: pkg.version, APP_CHANNEL: beta ? "beta" : "live", APP_BASE_PATH: basePath },
};

export default nextConfig;
