import { defineConfig } from "vitest/config";

export default defineConfig({
  root: "src",
  base: "./",
  cacheDir: "../node_modules/.vite",
  build: {
    outDir: "../dist",
    chunkSizeWarningLimit: 2000,
  },
  test: {
    environment: "node",
    include: ["../test/**/*.test.ts"],
  },
});
