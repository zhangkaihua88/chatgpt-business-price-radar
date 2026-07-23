import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  base: "./",
  plugins: [react()],
  build: {
    target: "es2022",
    sourcemap: true,
  },
  test: {
    environment: "jsdom",
    setupFiles: "./src/test-setup.ts",
    css: true,
  },
});
