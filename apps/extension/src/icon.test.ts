import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const svg = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "../assets/icon.svg"), "utf8");

describe("icon", () => {
  it("is a teal question mark on paper stroke", () => {
    expect(svg).toContain('fill="#0b6e70"');
    expect(svg).toContain("#f6f3ee");
    expect(svg).toContain("<circle");
    expect(svg).not.toContain("M64 22v84");
    expect(svg).not.toContain("M36 106h56");
  });
});
