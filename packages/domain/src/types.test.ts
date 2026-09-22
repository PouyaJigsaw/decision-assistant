import { describe, expect, it } from "vitest";
import { criterionSchema, CONFIDENCE_THRESHOLD, sampleRubric } from "./index";

describe("criterionSchema", () => {
  it("accepts the sample rubric and rejects an unknown kind", () => {
    expect(CONFIDENCE_THRESHOLD).toBe(0.75);
    expect(sampleRubric.map((c) => c.id)).toEqual(["go", "distributed", "no-ownership", "seniority"]);
    expect(criterionSchema.safeParse(sampleRubric[0]).success).toBe(true);
    expect(criterionSchema.safeParse({ ...sampleRubric[0], kind: "nice" }).success).toBe(false);
  });
});
