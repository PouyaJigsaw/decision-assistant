import { describe, expect, it } from "vitest";
import { countsAsUse, groundExcerpt, preflight, usesRemaining } from "./index";

describe("preflight", () => {
  it("refuses a disabled kill switch without counting a use", () => {
    expect(preflight({ evaluationsEnabled: false, successCount: 0 })).toEqual({
      proceed: false,
      reason: "kill_switch",
      countsAsUse: false,
      completedRefusal: false,
    });
  });

  it("refuses the fourth profile as a completed trial cap", () => {
    expect(preflight({ evaluationsEnabled: true, successCount: 3 })).toEqual({
      proceed: false,
      reason: "trial_cap",
      countsAsUse: false,
      completedRefusal: true,
    });
  });

  it("proceeds when a use remains", () => {
    expect(preflight({ evaluationsEnabled: true, successCount: 2 })).toEqual({ proceed: true });
  });
});

describe("countsAsUse", () => {
  it("counts only a valid Jev result that is not a replay", () => {
    expect(countsAsUse({ jevValid: false, idempotencyReplay: false })).toBe(false);
    expect(countsAsUse({ jevValid: false, idempotencyReplay: true })).toBe(false);
    expect(countsAsUse({ jevValid: true, idempotencyReplay: true })).toBe(false);
    expect(countsAsUse({ jevValid: true, idempotencyReplay: false })).toBe(true);
  });
});

describe("usesRemaining", () => {
  it("clamps remaining uses at zero", () => {
    expect(usesRemaining(0)).toBe(3);
    expect(usesRemaining(3)).toBe(0);
    expect(usesRemaining(4)).toBe(0);
  });
});

describe("groundExcerpt", () => {
  it("grounds a normalized substring and rejects misses", () => {
    expect(groundExcerpt("Led the payments API in Go.", "payments   API")).toEqual({
      grounded: true,
      excerpt: "payments API",
    });
    expect(groundExcerpt("Led the payments API in Go.", "Python for ten years")).toEqual({
      grounded: false,
      excerpt: null,
    });
    expect(groundExcerpt("Led the payments API in Go.", "   ")).toEqual({
      grounded: false,
      excerpt: null,
    });
  });
});
