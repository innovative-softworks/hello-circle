import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    setupFiles: ["./vitest.setup.ts"],
    // DB-backed tests (row locks, concurrency) genuinely take longer than
    // vitest's 5s default — see server/TESTING.md.
    testTimeout: 15000,
    hookTimeout: 15000,
    // Concurrency tests intentionally hit the same DB rows from parallel
    // requests within a single test — running test *files* in parallel on
    // top of that adds unrelated cross-file contention for no benefit at
    // this suite's current size.
    fileParallelism: false,
  },
});
