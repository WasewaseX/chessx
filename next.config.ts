import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  // Type errors fail the build: broken types must never reach production
  // silently (audit finding). CI runs `bun run typecheck` alongside lint.
  typescript: {
    ignoreBuildErrors: false,
  },
  reactStrictMode: false,
};

export default nextConfig;
