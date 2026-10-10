import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Booking data must always be live, so we use the request-time rendering
  // model instead of Cache Components. See README → "Architecture decisions".
  cacheComponents: false,
  // Native / heavy server-only packages: keep them out of the bundler.
  serverExternalPackages: ["@huggingface/transformers", "onnxruntime-node", "pg", "bcryptjs"],
  poweredByHeader: false,
  // Keep the dev-only indicator away from the sidebar's account panel (bottom-left).
  devIndicators: { position: "bottom-right" },
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
