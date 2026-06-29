import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Self-contained server bundle for the standalone Docker image.
  output: "standalone",
  // Allow remote cover/screenshot images from IGDB and RomM metadata sources.
  // NOTE: keep this an explicit allowlist — the Next image optimizer (/_next/image)
  // is NOT behind the auth middleware (it's excluded by the matcher), so a wildcard
  // host turns it into an unauthenticated open proxy / SSRF vector.
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "images.igdb.com" },
      { protocol: "https", hostname: "**.igdb.com" },
      { protocol: "https", hostname: "cdn.cloudflare.steamstatic.com" },
    ],
  },
  // better-sqlite3-style native deps aren't used (libsql is prebuilt),
  // but keep server externals explicit for the worker runtime.
  // `unzipper` has an optional `@aws-sdk/client-s3` require (its S3 open mode,
  // which we never use); keeping it external stops the bundler from trying to
  // resolve that dependency at build time.
  serverExternalPackages: ["@libsql/client", "unzipper"],
  // Baseline security headers for an internet-exposable deployment. We keep the
  // CSP intentionally narrow (clickjacking / base-uri / plugin embedding) rather
  // than restricting script/connect/img: socket.io connects to the user-configured
  // RomM origin and Next ships inline bootstrap scripts, so a strict script-src/
  // connect-src would break the app. Tighten later with nonces if desired.
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "no-referrer" },
          {
            key: "Content-Security-Policy",
            value: "frame-ancestors 'none'; base-uri 'self'; object-src 'none'",
          },
          // Harmless over plain HTTP (browsers ignore it); enforced once HTTPS.
          {
            key: "Strict-Transport-Security",
            value: "max-age=31536000; includeSubDomains",
          },
        ],
      },
    ];
  },
};

export default nextConfig;
