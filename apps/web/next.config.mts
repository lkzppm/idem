import type { NextConfig } from "next";

const config: NextConfig = {
  reactStrictMode: true,
  // Workspace packages export TypeScript source (`./src/index.ts`).
  transpilePackages: ["@idem/core", "@idem/sim", "@idem/gateway", "@idem/mcp", "@idem/ndn"],
};

export default config;
