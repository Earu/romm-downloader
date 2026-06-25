import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Self-contained server bundle for the standalone Docker image.
  output: "standalone",
  // Allow remote cover/screenshot images from IGDB and RomM metadata sources.
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "images.igdb.com" },
      { protocol: "https", hostname: "**.igdb.com" },
      { protocol: "https", hostname: "cdn.cloudflare.steamstatic.com" },
      { protocol: "https", hostname: "**" },
    ],
  },
  // better-sqlite3-style native deps aren't used (libsql is prebuilt),
  // but keep server externals explicit for the worker runtime.
  // `unzipper` has an optional `@aws-sdk/client-s3` require (its S3 open mode,
  // which we never use); keeping it external stops the bundler from trying to
  // resolve that dependency at build time.
  serverExternalPackages: ["@libsql/client", "unzipper"],
};

export default nextConfig;
