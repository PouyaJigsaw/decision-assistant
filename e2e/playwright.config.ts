import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { defineConfig } from "@playwright/test";

function loadApiEnv() {
  const path = resolve(process.cwd(), "apps/api/.env");
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq < 0) continue;
    const key = trimmed.slice(0, eq).trim();
    const value = trimmed.slice(eq + 1).trim();
    if (key && process.env[key] === undefined) process.env[key] = value;
  }
}

loadApiEnv();

export default defineConfig({
  testDir: ".",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 60_000,
  outputDir: "./test-results",
  reporter: [["list"]],
  use: {
    headless: false,
    trace: "retain-on-failure",
  },
  projects: [
    { name: "sign-in", testMatch: /sign-in\.spec\.ts/ },
    { name: "rubric", testMatch: /rubric\.spec\.ts/, dependencies: ["sign-in"] },
    { name: "capture-linkedin", testMatch: /capture-linkedin\.spec\.ts/, dependencies: ["rubric"] },
    { name: "evaluate", testMatch: /evaluate\.spec\.ts/, dependencies: ["capture-linkedin"] },
  ],
});
