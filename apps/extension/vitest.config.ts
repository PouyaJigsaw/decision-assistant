import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    env: { VITE_API_ORIGIN: "http://127.0.0.1:8787" },
  },
});
