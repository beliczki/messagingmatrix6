import type { NextConfig } from "next";

const config: NextConfig = {
  reactStrictMode: true,
  // playwright: imported by src/lib/preview-shooter.ts from API routes — must
  // stay external or the build bundles a broken browser resolver.
  serverExternalPackages: ["better-sqlite3", "playwright", "playwright-core"],
};

export default config;
