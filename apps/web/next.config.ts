import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: [
    "@redgest/core",
    "@redgest/db",
    "@redgest/config",
    "@redgest/reddit",
    "@redgest/auth",
  ],
  reactStrictMode: true,

  // Prevent pg/prisma adapter from being bundled into client chunks.
  // Client components import enums from @redgest/db which barrel-exports
  // the Prisma client — serverExternalPackages keeps Node-only deps server-side.
  serverExternalPackages: ["pg", "@prisma/adapter-pg"],

  // Point Turbopack to the monorepo root so it finds the correct lockfile
  turbopack: {
    root: "../..",
  },
};

export default nextConfig;
