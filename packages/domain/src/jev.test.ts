import { describe, expect, it } from "vitest";
import { parseJevResponse, sampleRubric, toJevRequest } from "./index";

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

const choiceAnswer = (choice: string, confidence: number) => ({
  type: "choice",
  choice,
  confidence,
  probabilities: { match: 0.7, mismatch: 0.1, no_evidence: 0.1, contradictory: 0.1 },
});

const validPayload = {
  model: "jev-1.13.0",
  answers: {
    go: choiceAnswer("match", 0.9),
    distributed: choiceAnswer("match", 0.85),
    "no-ownership": choiceAnswer("mismatch", 0.8),
    seniority: {
      type: "score",
      score: 1.15,
      confidence: 0.8,
      probabilities: { "0": 0.05, "1": 0.8, "2": 0.1, "3": 0.05 },
    },
  },
  usage: { input_tokens: 2180, output_tokens: 36 },
};

describe("parseJevResponse", () => {
  it("maps a versioned payload into answers with named seniority levels", () => {
    const parsed = parseJevResponse(sampleRubric, validPayload);
    expect(parsed).toMatchObject({
      ok: true,
      model: "jev-1.13.0",
      usage: { inputTokens: 2180, outputTokens: 36 },
    });
    if (!parsed.ok) return;
    const seniority = parsed.answers.find((a) => a.criterionId === "seniority");
    expect(seniority).toEqual({
      criterionId: "seniority",
      result: "aligned",
      confidence: 0.8,
      probabilities: { below: 0.05, aligned: 0.8, above: 0.1, unclear: 0.05 },
      excerpt: null,
    });
    expect(parsed.answers.every((a) => a.excerpt === null)).toBe(true);
  });

  it("rejects the jev-latest alias", () => {
    expect(parseJevResponse(sampleRubric, { ...validPayload, model: "jev-latest" })).toEqual({
      ok: false,
      reason: "invalid_jev",
    });
  });

  it("rejects a missing criterion id", () => {
    const { go: _go, ...rest } = validPayload.answers;
    expect(parseJevResponse(sampleRubric, { ...validPayload, answers: rest })).toEqual({
      ok: false,
      reason: "invalid_jev",
    });
  });

  it("rejects an extra answer id", () => {
    expect(
      parseJevResponse(sampleRubric, {
        ...validPayload,
        answers: { ...validPayload.answers, extra: choiceAnswer("match", 0.9) },
      }),
    ).toEqual({ ok: false, reason: "invalid_jev" });
  });

  it("rejects a choice outside the option set", () => {
    expect(
      parseJevResponse(sampleRubric, {
        ...validPayload,
        answers: { ...validPayload.answers, go: choiceAnswer("maybe", 0.9) },
      }),
    ).toEqual({ ok: false, reason: "invalid_jev" });
  });

  it("rejects confidence outside 0 to 1", () => {
    expect(
      parseJevResponse(sampleRubric, {
        ...validPayload,
        answers: { ...validPayload.answers, go: choiceAnswer("match", 1.01) },
      }),
    ).toEqual({ ok: false, reason: "invalid_jev" });
    expect(
      parseJevResponse(sampleRubric, {
        ...validPayload,
        answers: { ...validPayload.answers, go: choiceAnswer("match", -0.01) },
      }),
    ).toEqual({ ok: false, reason: "invalid_jev" });
  });

  it("breaks a score tie toward the earlier index", () => {
    const parsed = parseJevResponse(sampleRubric, {
      ...validPayload,
      answers: {
        ...validPayload.answers,
        seniority: {
          type: "score",
          score: 0.5,
          confidence: 0.8,
          probabilities: { "0": 0.4, "1": 0.4, "2": 0.1, "3": 0.1 },
        },
      },
    });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.answers.find((a) => a.criterionId === "seniority")?.result).toBe("below");
  });

  it("preserves usage.output_tokens on the usage object", () => {
    const parsed = parseJevResponse(sampleRubric, validPayload);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.usage.outputTokens).toBe(36);
  });
});
