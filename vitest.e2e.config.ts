import { defineConfig } from "vitest/config";

// Live end-to-end config: includes ONLY test/e2e (which is excluded from the
// default `npm test`). These tests hit the real Octen API and are gated on
// OCTEN_API_KEY. Single-fork + no isolation keeps the long network calls
// stable and avoids spawning many parallel workers against the live API.
export default defineConfig({
  test: {
    include: ["test/e2e/**/*.test.ts"],
    environment: "node",
    testTimeout: 200_000,
    hookTimeout: 200_000,
    pool: "forks",
    poolOptions: { forks: { singleFork: true } },
  },
});
