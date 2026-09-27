import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: { alias: { "@": path.resolve(__dirname, "src"), "@fixtures": path.resolve(__dirname, "fixtures") } },
  esbuild: { jsx: "automatic" }, test: { include: ["src/**/*.test.ts", "src/**/*.test.tsx", "fixtures/**/*.test.ts"], environment: "node" },
});
