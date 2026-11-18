import { defineProject } from "vitest/config";

export default defineProject({
  test: {
    name: "bench-ndn",
    include: ["src/**/*.test.ts"],
  },
});
