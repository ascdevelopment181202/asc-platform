import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Every page here reads live client data, so plain dynamic rendering is simpler than Cache Components.
  cacheComponents: false,
  // Logo uploads go through server actions (default limit is 1 MB).
  experimental: { serverActions: { bodySizeLimit: "5mb" } },
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
