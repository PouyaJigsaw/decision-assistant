import { describe, expect, it } from "vitest";
import { sampleRubric, scanSafety, validateRubric } from "./index";

describe("scanSafety", () => {
  it("hits protected terms and ignores lookalikes", () => {
    expect(scanSafety("Must be under a certain age").ok).toBe(false);
    expect(scanSafety("We hire for cultural fit").ok).toBe(false);
    expect(scanSafety("Owns the payments page").ok).toBe(true);
    expect(scanSafety("agent experience").ok).toBe(true);
    expect(scanSafety("healthcare platform experience").ok).toBe(true);
    expect(scanSafety("five years of Go").ok).toBe(true);
  });
});

describe("validateRubric", () => {
  it("accepts the sample rubric", () => {
    expect(validateRubric(sampleRubric)).toEqual({ ok: true });
  });

  it("rejects a rubric with no requirement", () => {
    const onlyPrefs = sampleRubric.filter((c) => c.kind !== "requirement");
    expect(validateRubric(onlyPrefs)).toEqual({ ok: false, reason: "empty_requirement" });
  });

  it("rejects a second seniority and a protected prompt", () => {
    const extra = { id: "level-2", kind: "seniority" as const, label: "Staff", prompt: "Is the candidate staff?" };
    expect(validateRubric([...sampleRubric, extra]).reason).toBe("duplicate_seniority");
    const biased = sampleRubric.map((c) => c.id === "go" ? { ...c, prompt: "Is the candidate's age over 40?" } : c);
    expect(validateRubric(biased)).toMatchObject({ ok: false, reason: "safety", term: "age" });
  });
});
