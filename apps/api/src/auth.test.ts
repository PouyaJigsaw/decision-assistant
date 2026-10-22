import { describe, expect, it } from "vitest";
import { seedUser, sessionExpiresAt, verifyPassword } from "./auth";
import { openDatabase } from "./db/client";
import type { Env } from "./env";

function seedEnv(password: string): Env {
  return {
    accountEmail: "recruiter@example.com",
    accountPassword: password,
    evaluationsEnabled: true,
    trialSuccessCap: 3,
    dailySpendCapUsd: 5,
    databasePath: ":memory:",
    host: "127.0.0.1",
    port: 8787,
    llmPrice: { inputUsdPerMillion: 3, outputUsdPerMillion: 15 },
    jevModel: "jev-1.13.0",
    jevPrice: { inputUsdPerMillion: 0.042, outputUsdPerMillion: 0 },
    providers: "fake",
    typesafeApiKey: "",
    llmApiKey: "",
    llmModel: "",
  };
}

describe("sessionExpiresAt", () => {
  it("expires a session after 30 days", () => {
    const now = Date.parse("2026-01-01T00:00:00.000Z");
    expect(sessionExpiresAt(now)).toBe(now + 30 * 24 * 60 * 60 * 1000);
  });
});

describe("seedUser", () => {
  it("updates the stored hash when ACCOUNT_PASSWORD changes", () => {
    const db = openDatabase(":memory:");
    seedUser(db, seedEnv("sitting-password"));
    const afterRotate = seedUser(db, seedEnv("rotated-host-password"));
    expect(verifyPassword("sitting-password", afterRotate.passwordHash)).toBe(false);
    expect(verifyPassword("rotated-host-password", afterRotate.passwordHash)).toBe(true);
  });
});
