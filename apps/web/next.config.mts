import type { NextConfig } from "next";

const config: NextConfig = {
  reactStrictMode: true,
  // Workspace packages export TypeScript source (`./src/index.ts`).
  transpilePackages: ["@idem/core", "@idem/sim", "@idem/gateway", "@idem/mcp", "@idem/ndn"],
  // The "Results" tab was renamed "Benchmarks" (2026-11-18); old links keep working.
  async redirects() {
    return [{ source: "/results", destination: "/benchmarks", permanent: true }];
  },
};

export default config;
