import type { NextConfig } from "next";

const config: NextConfig = {
  reactStrictMode: true,
  // A build must never write into the `.next` the running server is reading from:
  // `next build` clears the dist dir, and the live process then dies on a missing
  // required-server-files.json for the whole build. The deploy builds into
  // `.next-build` and swaps the directory in afterwards, so the outage is the
  // swap plus the restart instead of the entire build.
  distDir: process.env.NEXT_DIST_DIR || ".next",
  // playwright: imported by src/lib/preview-shooter.ts from API routes — must
  // stay external or the build bundles a broken browser resolver.
  serverExternalPackages: ["better-sqlite3", "playwright", "playwright-core"],
};

export default config;
