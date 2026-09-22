import { describe, expect, it } from "vitest";
import { POLICY_VERSION, recommend, sampleRubric } from "./index";
import type { Criterion, CriterionAnswer } from "./index";

const CHOICE = ["match", "mismatch", "no_evidence", "contradictory"] as const;
const SENIORITY = ["below", "aligned", "above", "unclear"] as const;

function answer(id: string, result: string, confidence: number): CriterionAnswer {
  const keys = (SENIORITY as readonly string[]).includes(result) ? SENIORITY : CHOICE;
  const probabilities: Record<string, number> = {};
  for (const key of keys) probabilities[key] = key === result ? confidence : 0;
  return { criterionId: id, result: result as CriterionAnswer["result"], confidence, probabilities, excerpt: null };
}

function sampleAnswers(overrides: Record<string, { result: string; confidence: number }> = {}): CriterionAnswer[] {
  const defaults: Record<string, { result: string; confidence: number }> = {
    go: { result: "match", confidence: 0.9 },
    distributed: { result: "match", confidence: 0.9 },
    "no-ownership": { result: "mismatch", confidence: 0.9 },
    seniority: { result: "aligned", confidence: 0.9 },
  };
  return sampleRubric.map((criterion) => {
    const next = overrides[criterion.id] ?? defaults[criterion.id]!;
    return answer(criterion.id, next.result, next.confidence);
  });
}

describe("recommend", () => {
  it("investigates a required no_evidence and scores that requirement as 0", () => {
    const result = recommend(sampleRubric, sampleAnswers({ go: { result: "no_evidence", confidence: 0.9 } }));
    expect(result.action).toBe("investigate");
    expect(result.reasonCode).toBe("missing_evidence");
    expect(result.policyVersion).toBe(POLICY_VERSION);
    expect(result.score).toBe(60);
  });

  it("investigates a required contradictory as missing evidence", () => {
    const result = recommend(sampleRubric, sampleAnswers({ go: { result: "contradictory", confidence: 0.9 } }));
    expect(result).toMatchObject({ action: "investigate", reasonCode: "missing_evidence" });
  });

  it("treats 0.75 as confirmed and 0.749 as investigate", () => {
    expect(recommend(sampleRubric, sampleAnswers({ go: { result: "match", confidence: 0.749 } })).action).toBe(
      "investigate",
    );
    expect(recommend(sampleRubric, sampleAnswers({ go: { result: "match", confidence: 0.75 } }))).toMatchObject({
      action: "contact",
      reasonCode: "all_confident_matches",
    });
  });

  it("skips a confident required mismatch", () => {
    expect(recommend(sampleRubric, sampleAnswers({ go: { result: "mismatch", confidence: 0.9 } }))).toMatchObject({
      action: "skip",
      reasonCode: "required_mismatch",
    });
  });

  it("treats seniority below as skip, above as match, and unclear as investigate", () => {
    expect(recommend(sampleRubric, sampleAnswers({ seniority: { result: "below", confidence: 0.9 } }))).toMatchObject({
      action: "skip",
      reasonCode: "seniority_mismatch",
    });
    expect(recommend(sampleRubric, sampleAnswers({ seniority: { result: "above", confidence: 0.9 } })).action).toBe(
      "contact",
    );
    expect(recommend(sampleRubric, sampleAnswers({ seniority: { result: "unclear", confidence: 0.9 } })).action).toBe(
      "investigate",
    );
  });

  it("contacts when a disqualifier is confident no_evidence", () => {
    expect(
      recommend(sampleRubric, sampleAnswers({ "no-ownership": { result: "no_evidence", confidence: 0.9 } })).action,
    ).toBe("contact");
  });

  it("investigates a shaky disqualifier and skips a confident match", () => {
    expect(
      recommend(sampleRubric, sampleAnswers({ "no-ownership": { result: "match", confidence: 0.74 } })),
    ).toMatchObject({ action: "investigate", reasonCode: "shaky_disqualifier" });
    expect(
      recommend(sampleRubric, sampleAnswers({ "no-ownership": { result: "match", confidence: 0.9 } })),
    ).toMatchObject({ action: "skip", reasonCode: "disqualifier_match" });
    expect(
      recommend(sampleRubric, sampleAnswers({ "no-ownership": { result: "contradictory", confidence: 0.9 } })),
    ).toMatchObject({ action: "investigate", reasonCode: "shaky_disqualifier" });
  });

  it("saves for later when a preference is not a confident match", () => {
    expect(
      recommend(sampleRubric, sampleAnswers({ distributed: { result: "mismatch", confidence: 0.9 } })),
    ).toMatchObject({ action: "save_for_later", reasonCode: "preference_shortfall" });
  });

  it("scores requirement 1 and preference 0.5 and ignores disqualifiers", () => {
    const slim: Criterion[] = [
      { id: "go", kind: "requirement", label: "Go", prompt: "Go?" },
      { id: "distributed", kind: "preference", label: "Distributed", prompt: "Distributed?" },
      { id: "no-ownership", kind: "disqualifier", label: "Ownership", prompt: "Ownership?" },
    ];
    const result = recommend(slim, [
      answer("go", "match", 0.9),
      answer("distributed", "mismatch", 0.9),
      answer("no-ownership", "match", 0.9),
    ]);
    expect(result.score).toBe(67);
  });

  it("investigates when required evidence is missing even if a disqualifier matches", () => {
    expect(
      recommend(
        sampleRubric,
        sampleAnswers({
          go: { result: "no_evidence", confidence: 0.9 },
          "no-ownership": { result: "match", confidence: 0.9 },
        }),
      ).action,
    ).toBe("investigate");
  });
});
