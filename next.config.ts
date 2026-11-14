import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Every page here reads live client data, so plain dynamic rendering is simpler than Cache Components.
  cacheComponents: false,
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
