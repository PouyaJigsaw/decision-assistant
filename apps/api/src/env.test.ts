import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { loadDotenv, readEnv } from "./env";

describe("loadDotenv", () => {
  it("is a no-op when .env is missing so Fly secrets stay the only source in production", () => {
    const dir = mkdtempSync(join(tmpdir(), "da-env-"));
    expect(loadDotenv(dir)).toEqual({ loaded: false, path: join(dir, ".env") });
  });

  it("fills unset keys from .env and does not override existing process env", () => {
    const dir = mkdtempSync(join(tmpdir(), "da-env-"));
    writeFileSync(join(dir, ".env"), "TYPESAFE_API_KEY=from-file\nACCOUNT_EMAIL=from-file\n");
    const previousEmail = process.env.ACCOUNT_EMAIL;
    const previousKey = process.env.TYPESAFE_API_KEY;
    process.env.ACCOUNT_EMAIL = "already-set";
    delete process.env.TYPESAFE_API_KEY;
    try {
      expect(loadDotenv(dir)).toMatchObject({ loaded: true });
      expect(process.env.TYPESAFE_API_KEY).toBe("from-file");
      expect(process.env.ACCOUNT_EMAIL).toBe("already-set");
    } finally {
      if (previousEmail === undefined) delete process.env.ACCOUNT_EMAIL;
      else process.env.ACCOUNT_EMAIL = previousEmail;
      if (previousKey === undefined) delete process.env.TYPESAFE_API_KEY;
      else process.env.TYPESAFE_API_KEY = previousKey;
    }
  });
});

describe("readEnv", () => {
  it("refuses to start without the trial account", () => {
    expect(() => readEnv({})).toThrow(/ACCOUNT_EMAIL/);
    expect(() => readEnv({ ACCOUNT_EMAIL: "recruiter@example.com" })).toThrow(/ACCOUNT_PASSWORD/);
  });

  const credentials = {
    ACCOUNT_EMAIL: "recruiter@example.com",
    ACCOUNT_PASSWORD: "sitting-password",
    DATABASE_PATH: "data/decision-assistant.db",
  };

  it("binds the local API to loopback by default", () => {
    expect(readEnv(credentials).host).toBe("127.0.0.1");
  });

  it("defaults providers to live and keys to empty so tests do not need network credentials", () => {
    expect(readEnv(credentials)).toMatchObject({
      providers: "live",
      typesafeApiKey: "",
      llmApiKey: "",
      llmModel: "",
      llmPrice: { inputUsdPerMillion: 3, outputUsdPerMillion: 15 },
      jevModel: "jev-1.13.0",
      jevPrice: { inputUsdPerMillion: 0.042, outputUsdPerMillion: 0 },
    });
  });

  it("treats PROVIDERS=fake as fake and any other value as live", () => {
    expect(readEnv({ ...credentials, PROVIDERS: "fake" }).providers).toBe("fake");
    expect(readEnv({ ...credentials, PROVIDERS: "live" }).providers).toBe("live");
    expect(readEnv({ ...credentials, PROVIDERS: "other" }).providers).toBe("live");
  });

  it("reads LLM key, model, and price vars when set and keeps price defaults when they are unset", () => {
    expect(
      readEnv({
        ...credentials,
        LLM_API_KEY: "llm-key",
        LLM_MODEL: "llm-model",
      }),
    ).toMatchObject({ llmApiKey: "llm-key", llmModel: "llm-model" });
    expect(
      readEnv({
        ...credentials,
        LLM_INPUT_USD_PER_MILLION: "2",
        LLM_OUTPUT_USD_PER_MILLION: "10",
      }).llmPrice,
    ).toEqual({ inputUsdPerMillion: 2, outputUsdPerMillion: 10 });
    expect(readEnv(credentials).llmPrice).toEqual({ inputUsdPerMillion: 3, outputUsdPerMillion: 15 });
  });

  it("reads Jev model and price vars and defaults to the published 1.13 rates", () => {
    expect(
      readEnv({
        ...credentials,
        JEV_MODEL: "jev-latest",
        JEV_INPUT_USD_PER_MILLION: "0.08",
        JEV_OUTPUT_USD_PER_MILLION: "0.01",
      }),
    ).toMatchObject({
      jevModel: "jev-latest",
      jevPrice: { inputUsdPerMillion: 0.08, outputUsdPerMillion: 0.01 },
    });
    expect(readEnv(credentials)).toMatchObject({
      jevModel: "jev-1.13.0",
      jevPrice: { inputUsdPerMillion: 0.042, outputUsdPerMillion: 0 },
    });
  });

  it("requires DATABASE_PATH and returns the hosted volume path when set", () => {
    expect(() =>
      readEnv({ ACCOUNT_EMAIL: "recruiter@example.com", ACCOUNT_PASSWORD: "sitting-password" }),
    ).toThrow("DATABASE_PATH is required");
    expect(readEnv({ ...credentials, DATABASE_PATH: "/data/decision-assistant.db" }).databasePath).toBe(
      "/data/decision-assistant.db",
    );
  });

  it("defaults the trial cap to 3 and treats infinite as unlimited", () => {
    expect(readEnv(credentials).trialSuccessCap).toBe(3);
    expect(readEnv({ ...credentials, TRIAL_SUCCESS_CAP: "10" }).trialSuccessCap).toBe(10);
    expect(readEnv({ ...credentials, TRIAL_SUCCESS_CAP: "infinite" }).trialSuccessCap).toBe(null);
    expect(readEnv({ ...credentials, TRIAL_SUCCESS_CAP: "0" }).trialSuccessCap).toBe(null);
  });

  it("throws when resolved prices are not finite or are negative", () => {
    expect(() => readEnv({ ...credentials, LLM_INPUT_USD_PER_MILLION: "nope" })).toThrow();
    expect(() => readEnv({ ...credentials, LLM_OUTPUT_USD_PER_MILLION: "-1" })).toThrow();
    expect(() => readEnv({ ...credentials, LLM_INPUT_USD_PER_MILLION: "Infinity" })).toThrow();
  });
});
