import type { NextConfig } from "next";

// onnxruntime-node JS + the Linux x64 native binaries only (Vercel runs Linux x64).
const ONNX_RUNTIME_FILES = [
  "./node_modules/onnxruntime-node/package.json",
  "./node_modules/onnxruntime-node/dist/**/*",
  "./node_modules/onnxruntime-node/bin/napi-v6/linux/x64/**/*",
  "./node_modules/onnxruntime-common/**/*",
];

const nextConfig: NextConfig = {
  // Booking data must always be live, so we use the request-time rendering
  // model instead of Cache Components. See README → "Architecture decisions".
  cacheComponents: false,
  // Native / heavy server-only packages: keep them out of the bundler.
  serverExternalPackages: ["@huggingface/transformers", "onnxruntime-node", "pg", "bcryptjs"],
  poweredByHeader: false,
  // Serverless functions on Vercel are limited to 250 MB. onnxruntime-node ships native
  // binaries for every OS (~290 MB); deployments run on Linux x64, so drop the rest.
  // Local model files are downloaded at runtime and never bundled.
  // transformers.js loads onnxruntime-node via a runtime require that file tracing can't
  // follow, so include it explicitly for the routes that run local models.
  outputFileTracingIncludes: {
    "/api/assistant/**": ONNX_RUNTIME_FILES,
    "/api/admin/knowledge/**": ONNX_RUNTIME_FILES,
  },
  outputFileTracingExcludes: {
    "*": [
      "**/onnxruntime-node/bin/napi-v*/darwin/**",
      "**/onnxruntime-node/bin/napi-v*/win32/**",
      "**/onnxruntime-node/bin/napi-v*/linux/arm64/**",
      "**/onnxruntime-web/**",
      ".cache/**",
    ],
  },
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
