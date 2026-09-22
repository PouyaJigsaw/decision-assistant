import { describe, expect, it } from "vitest";
import { readEnv } from "./env";

describe("readEnv", () => {
  it("refuses to start without the trial account", () => {
    expect(() => readEnv({})).toThrow(/ACCOUNT_EMAIL/);
    expect(() => readEnv({ ACCOUNT_EMAIL: "recruiter@example.com" })).toThrow(/ACCOUNT_PASSWORD/);
  });

  it("binds the local API to loopback by default", () => {
    expect(
      readEnv({ ACCOUNT_EMAIL: "recruiter@example.com", ACCOUNT_PASSWORD: "sitting-password" }).host,
    ).toBe("127.0.0.1");
  });
});
