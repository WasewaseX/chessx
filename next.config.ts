import type { NextConfig } from "next";

// Build stamp: every production build carries the UTC timestamp it was made,
// surfaced in the footer via /api/build-info. This is how the owner verifies
// a deployment actually picked up the latest push (the Oct 18-vs-Oct-20
// confusion came from having no visible freshness signal at all).
function buildStamp(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}.${p(d.getUTCHours())}${p(d.getUTCMinutes())}utc`;
}

const nextConfig: NextConfig = {
  output: "standalone",
  generateBuildId: () => buildStamp(),
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
