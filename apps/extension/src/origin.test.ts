import { describe, expect, it } from "vitest";
import { HOSTED_API_ORIGIN, apiOrigin } from "./origin";

describe("apiOrigin", () => {
  it("keeps an explicit origin and strips a trailing slash", () => {
    expect(apiOrigin("https://decision-assistant.fly.dev/")).toBe("https://decision-assistant.fly.dev");
  });

  it("uses the configured origin ahead of the hosted default", () => {
    expect(HOSTED_API_ORIGIN).toBe("https://decision-assistant.fly.dev");
    expect(apiOrigin()).toBe("http://127.0.0.1:8787");
    expect(apiOrigin("")).toBe("http://127.0.0.1:8787");
  });
});
