import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Native / heavy server-only packages stay out of the bundle.
  serverExternalPackages: ["sharp", "better-sqlite3", "heic-convert", "archiver", "@prisma/adapter-better-sqlite3"],
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
