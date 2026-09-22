import { describe, expect, it } from "vitest";
import { JEV_PRICE, costFromUsage, formatUsd } from "./index";

describe("costFromUsage", () => {
  it("charges Jev input only", () => {
    const cost = costFromUsage({ inputTokens: 1_000_000, outputTokens: 1_000_000 }, JEV_PRICE);
    expect(cost).toEqual({ inputUsd: 0.042, outputUsd: 0, totalUsd: 0.042 });
  });

  it("keeps a stored LLM price when a later config object differs", () => {
    const stored = { inputUsdPerMillion: 3, outputUsdPerMillion: 15 };
    const later = { inputUsdPerMillion: 1, outputUsdPerMillion: 1 };
    const usage = { inputTokens: 2_460, outputTokens: 720 };
    const first = costFromUsage(usage, stored);
    const recomputed = costFromUsage(usage, stored);
    costFromUsage(usage, later);
    expect(recomputed).toEqual(first);
    expect(first.outputUsd).toBeCloseTo((720 * 15) / 1_000_000, 10);
    expect(first.totalUsd).not.toBeCloseTo(costFromUsage(usage, later).totalUsd, 10);
  });

  it("formats the Figma meter amounts", () => {
    const jev = costFromUsage({ inputTokens: 2180, outputTokens: 36 }, JEV_PRICE);
    expect(formatUsd(jev.totalUsd)).toBe("$0.00009");
    expect(formatUsd(0.014)).toBe("$0.014");
    expect(formatUsd(0.008)).toBe("$0.008");
    expect(formatUsd(0.0004)).toBe("$0.0004");
  });
});
