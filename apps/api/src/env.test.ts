import { describe, expect, it } from "vitest";
import { readEnv } from "./env";

describe("readEnv", () => {
  it("refuses to start without the trial account", () => {
    expect(() => readEnv({})).toThrow(/ACCOUNT_EMAIL/);
    expect(() => readEnv({ ACCOUNT_EMAIL: "recruiter@example.com" })).toThrow(/ACCOUNT_PASSWORD/);
  });

  const credentials = { ACCOUNT_EMAIL: "recruiter@example.com", ACCOUNT_PASSWORD: "sitting-password" };

  it("binds the local API to loopback by default", () => {
    expect(readEnv(credentials).host).toBe("127.0.0.1");
  });

  it("defaults providers to live and keys to empty so tests do not need network credentials", () => {
    expect(readEnv(credentials)).toMatchObject({
      providers: "live",
      typesafeApiKey: "",
      anthropicApiKey: "",
      anthropicModel: "",
      llmPrice: { inputUsdPerMillion: 3, outputUsdPerMillion: 15 },
    });
  });

  it("treats PROVIDERS=fake as fake and any other value as live", () => {
    expect(readEnv({ ...credentials, PROVIDERS: "fake" }).providers).toBe("fake");
    expect(readEnv({ ...credentials, PROVIDERS: "live" }).providers).toBe("live");
    expect(readEnv({ ...credentials, PROVIDERS: "other" }).providers).toBe("live");
  });

  it("reads Anthropic price vars when set and keeps LLM defaults when they are unset", () => {
    expect(
      readEnv({
        ...credentials,
        ANTHROPIC_INPUT_USD_PER_MILLION: "2",
        ANTHROPIC_OUTPUT_USD_PER_MILLION: "10",
      }).llmPrice,
    ).toEqual({ inputUsdPerMillion: 2, outputUsdPerMillion: 10 });
    expect(
      readEnv({
        ...credentials,
        LLM_INPUT_USD_PER_MILLION: "4",
        LLM_OUTPUT_USD_PER_MILLION: "16",
      }).llmPrice,
    ).toEqual({ inputUsdPerMillion: 4, outputUsdPerMillion: 16 });
    expect(
      readEnv({
        ...credentials,
        ANTHROPIC_INPUT_USD_PER_MILLION: "",
        LLM_INPUT_USD_PER_MILLION: "4",
      }).llmPrice,
    ).toEqual({ inputUsdPerMillion: 4, outputUsdPerMillion: 15 });
  });

  it("throws when resolved prices are not finite or are negative", () => {
    expect(() => readEnv({ ...credentials, ANTHROPIC_INPUT_USD_PER_MILLION: "nope" })).toThrow();
    expect(() => readEnv({ ...credentials, ANTHROPIC_OUTPUT_USD_PER_MILLION: "-1" })).toThrow();
    expect(() => readEnv({ ...credentials, LLM_INPUT_USD_PER_MILLION: "Infinity" })).toThrow();
  });
});
