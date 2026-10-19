import { describe, expect, it } from "vitest";
import { sampleRubric } from "./fixtures";
import {
  COMPARE_INSTRUCTIONS,
  COMPARE_JSON_SCHEMA,
  DRAFT_INSTRUCTIONS,
  compareLlmRequest,
  parseCompareCompletion,
  parseDraftCompletion,
  draftLlmRequest,
} from "./llm";

const NOTES = "Need five years of Go.";
const PROFILE = "Staff engineer. Led the payments API in Go for four years.";

describe("draftLlmRequest", () => {
  it("uses the shared draft instructions and the job notes as input", () => {
    expect(draftLlmRequest(NOTES)).toEqual({
      instructions: DRAFT_INSTRUCTIONS,
      input: NOTES,
    });
    expect(DRAFT_INSTRUCTIONS).toContain("Return only JSON");
    expect(DRAFT_INSTRUCTIONS).toContain("protected traits");
    expect(DRAFT_INSTRUCTIONS).toContain("Has this person");
    expect(DRAFT_INSTRUCTIONS).toContain("Evidence to look for:");
    expect(DRAFT_INSTRUCTIONS).toContain("passionate");
    expect(DRAFT_INSTRUCTIONS).not.toContain("Synopsys");
  });
});

describe("compareLlmRequest", () => {
  it("uses the shared compare instructions and the Jev state payload as input", () => {
    const request = compareLlmRequest(sampleRubric, PROFILE);
    expect(request.instructions).toBe(COMPARE_INSTRUCTIONS);
    const payload = JSON.parse(request.input) as { state: string; questions: Record<string, { type: string }> };
    expect(payload.state).toBe(PROFILE);
    expect(Object.keys(payload.questions)).toEqual(sampleRubric.map((item) => item.id));
    expect(payload.questions.go?.type).toBe("choice");
    expect(payload.questions.seniority?.type).toBe("score");
    const go = payload.questions.go as { criteria?: { mismatch?: string; no_evidence?: string } };
    expect(go.criteria?.mismatch).toContain("Absence");
    expect(go.criteria?.no_evidence).toContain("missing degree");
    expect(COMPARE_INSTRUCTIONS).toContain("never a mismatch");
    expect(COMPARE_INSTRUCTIONS).toContain("only four years");
    expect(COMPARE_JSON_SCHEMA.required).toEqual(["answers"]);
  });
});

describe("parseDraftCompletion", () => {
  it("reads criteria from JSON text, including a fenced block", () => {
    expect(
      parseDraftCompletion(
        '{"criteria":[{"kind":"requirement","label":"Go","prompt":"Five years of Go?"}]}',
      ),
    ).toEqual({
      ok: true,
      criteria: [{ kind: "requirement", label: "Go", prompt: "Five years of Go?" }],
    });
    const screening =
      "Has this person investigated issues reported by QA?\nEvidence to look for: a described investigation and the fix.";
    expect(
      parseDraftCompletion(
        JSON.stringify({ criteria: [{ kind: "preference", label: "QA issues", prompt: screening }] }),
      ),
    ).toEqual({
      ok: true,
      criteria: [{ kind: "preference", label: "QA issues", prompt: screening }],
    });
    expect(
      parseDraftCompletion(
        '```json\n{"criteria":[{"kind":"preference","label":"Systems","prompt":"Distributed work?"}]}\n```',
      ),
    ).toEqual({
      ok: true,
      criteria: [{ kind: "preference", label: "Systems", prompt: "Distributed work?" }],
    });
  });

  it("rejects text that is not a criteria object", () => {
    expect(parseDraftCompletion("not json")).toEqual({ ok: false });
    expect(parseDraftCompletion("{}")).toEqual({ ok: false });
    expect(parseDraftCompletion('{"criteria":[{"kind":"other","label":"x","prompt":"y"}]}')).toEqual({
      ok: false,
    });
  });
});

describe("parseCompareCompletion", () => {
  it("reads answers from an array payload", () => {
    expect(
      parseCompareCompletion(
        '{"answers":[{"criterionId":"go","result":"match","confidence":0.91,"excerpt":"Led the payments API in Go for four years."}]}',
        sampleRubric,
      ),
    ).toEqual({
      ok: true,
      answers: [
        {
          criterionId: "go",
          result: "match",
          confidence: 0.91,
          excerpt: "Led the payments API in Go for four years.",
        },
      ],
    });
  });

  it("maps a keyed object payload into the same result labels", () => {
    expect(
      parseCompareCompletion(
        '```json\n{"go":"no_evidence","seniority":"Above the target seniority in the question."}\n```',
        sampleRubric,
      ),
    ).toEqual({
      ok: true,
      answers: [
        { criterionId: "go", result: "no_evidence", confidence: 0.5, excerpt: "" },
        { criterionId: "seniority", result: "above", confidence: 0.5, excerpt: "" },
      ],
    });
  });

  it("rejects compare when the text is not json", () => {
    expect(parseCompareCompletion("not json", sampleRubric)).toEqual({ ok: false });
  });
});
