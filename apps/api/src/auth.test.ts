import { describe, expect, it } from "vitest";
import { sessionExpiresAt } from "./auth";

describe("sessionExpiresAt", () => {
  it("expires a session after 30 days", () => {
    const now = Date.parse("2026-01-01T00:00:00.000Z");
    expect(sessionExpiresAt(now)).toBe(now + 30 * 24 * 60 * 60 * 1000);
  });
});
