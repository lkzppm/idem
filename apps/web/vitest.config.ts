import { defineConfig } from "vitest/config";

/**
 * Unit tests for the web app's pure modules (layout, motion, the Markdown renderer). `@/` resolves to
 * this app, as in `tsconfig.json`. Run: `pnpm exec vitest run --config apps/web/vitest.config.ts`.
 */
export default defineConfig({
  resolve: {
    alias: [{ find: /^@\//, replacement: `${import.meta.dirname}/` }],
  },
  test: {
    root: import.meta.dirname,
    include: ["lib/**/*.test.{ts,tsx}", "components/**/*.test.{ts,tsx}"],
    environment: "node",
  },
});
