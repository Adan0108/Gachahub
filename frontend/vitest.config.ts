import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: "node",
          environment: "node",
          include: ["lib/**/*.test.ts", "hooks/**/*.test.ts"],
        },
      },
      {
        test: {
          name: "jsdom",
          environment: "jsdom",
          setupFiles: ["./vitest.setup.js"],
          include: ["tests/**/*.test.{js,jsx}"],
          clearMocks: true,
        },
      },
    ],
  },
});
