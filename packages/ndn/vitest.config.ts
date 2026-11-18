import { defineProject } from "vitest/config";

export default defineProject({
  test: {
    name: "ndn",
    include: ["src/**/*.test.ts"],
    testTimeout: 30_000,
  },
});
