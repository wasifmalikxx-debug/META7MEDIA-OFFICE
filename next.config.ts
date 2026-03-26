import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["@prisma/client"],
  compress: true,
  poweredByHeader: false,
  reactStrictMode: true,
};

export default nextConfig;
