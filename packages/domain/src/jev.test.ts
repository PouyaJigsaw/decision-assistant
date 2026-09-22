import { describe, expect, it } from "vitest";
import { sampleRubric, toJevRequest } from "./index";

const profile = "Staff engineer. Led the payments API in Go for four years.";

describe("toJevRequest", () => {
  it("sends one questions map and keeps the profile out of the questions", () => {
    const request = toJevRequest(sampleRubric, profile);
    expect(request.model).toBe("jev-latest");
    expect(request.state).toBe(profile);
    expect(Object.keys(request.questions)).toEqual(["go", "distributed", "no-ownership", "seniority"]);
    expect(request.questions.go).toMatchObject({
      type: "choice",
      criteria: {
        match: expect.any(String),
        mismatch: expect.any(String),
        no_evidence: expect.any(String),
        contradictory: expect.any(String),
      },
    });
    expect(request.questions.seniority.type).toBe("score");
    expect(request.questions.seniority.criteria).toHaveLength(4);
    const blob = JSON.stringify(request.questions);
    expect(blob).not.toContain(profile);
    expect(request.state).not.toContain("five or more years");
    expect(request.questions.go.instructions).toContain("Is there evidence of at least five years of Go?");
  });
});
