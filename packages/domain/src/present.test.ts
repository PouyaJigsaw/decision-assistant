import { describe, expect, it } from "vitest";
import { presentAnswer, splitScreeningPrompt } from "./present";

describe("presentAnswer", () => {
  it("maps a confident match to Yes and a confident mismatch to No", () => {
    expect(presentAnswer({ kind: "requirement", result: "match", confidence: 0.9 })).toEqual({
      label: "Yes",
      detail: null,
      tone: "match",
      uncertain: false,
    });
    expect(presentAnswer({ kind: "requirement", result: "mismatch", confidence: 0.9 })).toEqual({
      label: "No",
      detail: null,
      tone: "mismatch",
      uncertain: false,
    });
  });

  it("maps missing evidence to Not sure and never to No", () => {
    expect(presentAnswer({ kind: "preference", result: "no_evidence", confidence: 0.95 })).toEqual({
      label: "Not sure",
      detail: "Not mentioned in the profile.",
      tone: "no_evidence",
      uncertain: true,
    });
  });

  it("maps contradictory and low-confidence calls to Not sure with distinct reasons", () => {
    expect(presentAnswer({ kind: "requirement", result: "contradictory", confidence: 0.9 })).toMatchObject({
      label: "Not sure",
      detail: "The profile contains conflicting information.",
      uncertain: true,
    });
    expect(presentAnswer({ kind: "requirement", result: "match", confidence: 0.74 })).toMatchObject({
      label: "Not sure",
      detail: "The evidence is inconclusive.",
      uncertain: true,
    });
    expect(presentAnswer({ kind: "requirement", result: "mismatch", confidence: 0.4 })).toMatchObject({
      label: "Not sure",
      detail: "The evidence is inconclusive.",
    });
  });

  it("shows a dealbreaker Yes as a negative finding", () => {
    expect(presentAnswer({ kind: "disqualifier", result: "match", confidence: 0.9 })).toEqual({
      label: "Yes",
      detail: "The exclusion condition is present.",
      tone: "mismatch",
      uncertain: false,
    });
  });

  it("keeps seniority labels and marks low confidence as uncertain", () => {
    expect(presentAnswer({ kind: "seniority", result: "below", confidence: 0.9 })).toMatchObject({
      label: "Below target",
      tone: "mismatch",
      uncertain: false,
    });
    expect(presentAnswer({ kind: "seniority", result: "aligned", confidence: 0.9 })).toMatchObject({
      label: "Aligned",
      tone: "match",
      uncertain: false,
    });
    expect(presentAnswer({ kind: "seniority", result: "above", confidence: 0.8 })).toMatchObject({
      label: "Above target",
      tone: "match",
      uncertain: false,
    });
    expect(presentAnswer({ kind: "seniority", result: "unclear", confidence: 0.9 })).toMatchObject({
      label: "Unclear",
      tone: "no_evidence",
      uncertain: true,
    });
    expect(presentAnswer({ kind: "seniority", result: "aligned", confidence: 0.4 })).toMatchObject({
      label: "Aligned",
      detail: "The evidence is inconclusive.",
      uncertain: true,
    });
  });
});

describe("splitScreeningPrompt", () => {
  it("separates the question from evidence guidance", () => {
    expect(
      splitScreeningPrompt(
        "Has this person defined performance criteria for a software product?\nEvidence to look for: measurable acceptance targets.",
      ),
    ).toEqual({
      question: "Has this person defined performance criteria for a software product?",
      evidence: "Evidence to look for: measurable acceptance targets.",
    });
  });

  it("keeps a prompt that has no evidence line as the question", () => {
    expect(splitScreeningPrompt("Is there evidence of Go?")).toEqual({
      question: "Is there evidence of Go?",
      evidence: null,
    });
  });
});
