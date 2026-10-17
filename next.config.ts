import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  // Type errors fail the build: broken types must never reach production
  // silently (audit finding). CI runs `bun run typecheck` alongside lint.
  typescript: {
    ignoreBuildErrors: false,
  },
  reactStrictMode: false,
  // Memory guard for small hosts (4GB sandbox): dev webpack grows an
  // unbounded in-memory cache as routes compile. One generation keeps the
  // last compilation per entry and rebuilds on change — slightly more CPU on
  // repeat edits, dramatically less resident memory, and no more OOM kills
  // when several views are compiled in a row. Production builds keep their
  // filesystem cache untouched.
  webpack: (config, { dev }) => {
    if (dev) {
      config.cache = { type: "memory", maxGenerations: 1 }
    }
    return config
  },
};

export default nextConfig;
