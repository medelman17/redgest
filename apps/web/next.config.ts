import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: [
    "@redgest/core",
    "@redgest/db",
    "@redgest/config",
    "@redgest/reddit",
  ],
  reactStrictMode: true,

  // Prevent pg/prisma adapter from being bundled into client chunks.
  // Client components import enums from @redgest/db which barrel-exports
  // the Prisma client — serverExternalPackages keeps Node-only deps server-side.
  serverExternalPackages: ["pg", "@prisma/adapter-pg"],

  // Turbopack doesn't support TypeScript's .js → .ts extension mapping
  // used by ESM packages with moduleResolution: "Node16". Use webpack
  // with extensionAlias until Turbopack adds support.
  webpack: (config) => {
    config.resolve.extensionAlias = {
      ".js": [".ts", ".tsx", ".js"],
      ".mjs": [".mts", ".mjs"],
    };
    return config;
  },
};

export default nextConfig;
