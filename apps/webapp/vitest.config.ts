import { defineConfig } from "vitest/config";

// Deliberately does not load the Solid/Tailwind plugins: the suites here
// exercise the pure client + diff modules, and the integration configs need a
// plain node environment so they can reach the real APIs without CORS.
export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
