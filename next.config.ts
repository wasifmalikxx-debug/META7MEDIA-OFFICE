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

  // M8: baseline security headers (the safe subset — NO Content-Security-Policy
  // yet; a strict CSP needs Report-Only tuning first because App Router emits
  // inline scripts/styles and the app calls external APIs). These four carry no
  // business-logic impact:
  //   - X-Frame-Options DENY: the portal is never iframed → blocks clickjacking
  //     of privileged actions (approve leave, lock payroll, send WhatsApp).
  //   - X-Content-Type-Options nosniff: stops MIME-confusion on uploaded images.
  //   - Referrer-Policy: don't leak full URLs to third parties.
  //   - HSTS (1y, no includeSubDomains/preload to stay reversible): enforce HTTPS.
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Strict-Transport-Security", value: "max-age=31536000" },
        ],
      },
    ];
  },
};

export default nextConfig;
