import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["@prisma/client"],
  compress: true,
  poweredByHeader: false,
  reactStrictMode: true,

  // Clean URL for the antidetect/proxy verification page so the team
  // can bookmark `/ipchecker` instead of `/ipchecker.html`. The actual
  // static file lives at `public/ipchecker.html` and is served at the
  // /ipchecker.html URL by default; this rewrite makes the extensionless
  // path serve the same file without changing the address bar.
  //
  // Per the Next.js rewrites docs: array-form rewrites are checked
  // AFTER /public files, so direct requests for `/ipchecker.html`
  // still hit the file. Only `/ipchecker` (no extension) goes through
  // this rewrite.
  async rewrites() {
    return [
      {
        source: "/ipchecker",
        destination: "/ipchecker.html",
      },
    ];
  },
};

export default nextConfig;
