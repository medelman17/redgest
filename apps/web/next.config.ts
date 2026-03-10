import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: [
    "@redgest/core",
    "@redgest/db",
    "@redgest/config",
    "@redgest/reddit",
  ],
  reactStrictMode: true,
};

export default nextConfig;
