import type { NextConfig } from "next";
import pkg from "./package.json";

const nextConfig: NextConfig = {
  output: "export",
  trailingSlash: true,
  images: { unoptimized: true },
  reactStrictMode: true,
  transpilePackages: ["three"],
  // shown in the main menu footer, links to /changelog
  env: { APP_VERSION: pkg.version },
};

export default nextConfig;
