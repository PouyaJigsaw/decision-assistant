import { COMPARE_INSTRUCTIONS, DRAFT_INSTRUCTIONS, sampleRubric } from "@decision-assistant/domain";
import { describe, expect, it } from "vitest";
import { createLiveLlm } from "./live-llm";

const DEFAPI_URL = "https://api.defapi.org/api/v1/messages";
const MODEL_OPTION = "anthropic/claude-opus-5";
const NOTES = "Need five years of Go.";
const PROFILE = "Staff engineer. Led the payments API in Go for four years.";

const DRAFT_TEXT = '{"criteria":[{"kind":"requirement","label":"Go","prompt":"Five years of Go?"}]}';
const COMPARE_TEXT =
  '{"answers":[{"criterionId":"go","result":"match","confidence":0.91,"excerpt":"Led the payments API in Go for four years."}]}';

function anthropicResponse(text: string, overrides?: { model?: string; usage?: { input_tokens: number; output_tokens: number } }) {
  return {
    model: overrides?.model ?? "claude-response-model",
    content: [{ type: "text" as const, text }],
    usage: overrides?.usage ?? { input_tokens: 10, output_tokens: 20 },
  };
}

function recordingFetch(text: string) {
  const recorded: { url: unknown; init?: RequestInit }[] = [];
  const fetchImpl: typeof fetch = async (url, init) => {
    recorded.push({ url, init });
    return new Response(JSON.stringify(anthropicResponse(text)), { status: 200 });
  };
  return { recorded, fetchImpl };
}

describe("createLiveLlm", () => {
  it("drafts criteria from the first text block and maps usage tokens", async () => {
    const { recorded, fetchImpl } = recordingFetch(DRAFT_TEXT);
    const llm = createLiveLlm({ apiKey: "test-key", model: MODEL_OPTION, fetchImpl });

    const result = await llm.draftRubric(NOTES);

    expect(recorded).toHaveLength(1);
    expect(recorded[0]?.url).toBe(DEFAPI_URL);
    const init = recorded[0]?.init;
    expect(init?.method).toBe("POST");
    expect(init?.signal).toBeInstanceOf(AbortSignal);
    const headers = new Headers(init?.headers);
    expect(headers.get("authorization")).toBe("Bearer test-key");
    expect(headers.get("accept")).toBe("application/json");
    expect(headers.get("content-type")).toBe("application/json");
    const body = JSON.parse(String(init?.body)) as {
      model: string;
      system: string;
      messages: { role: string; content: string }[];
    };
    expect(body.model).toBe(MODEL_OPTION);
    expect(body.system).toBe(DRAFT_INSTRUCTIONS);
    expect(body.messages).toEqual([{ role: "user", content: NOTES }]);
    expect(llm.calls).toBe(1);
    expect(result).toEqual({
      model: "claude-response-model",
      criteria: [{ kind: "requirement", label: "Go", prompt: "Five years of Go?" }],
      usage: { inputTokens: 10, outputTokens: 20 },
    });
  });

  it("compares once and returns the quoted excerpt", async () => {
    const { recorded, fetchImpl } = recordingFetch(COMPARE_TEXT);
    const llm = createLiveLlm({ apiKey: "test-key", model: MODEL_OPTION, fetchImpl });

    const result = await llm.compare({ approvedText: PROFILE, criteria: sampleRubric });

    expect(recorded).toHaveLength(1);
    const body = JSON.parse(String(recorded[0]?.init?.body)) as {
      system: string;
      messages: { role: string; content: string }[];
      output_config?: { format?: { type?: string; schema?: { type?: string; required?: string[] } } };
    };
    expect(body.system).toBe(COMPARE_INSTRUCTIONS);
    const payload = JSON.parse(body.messages[0]?.content ?? "") as {
      state: string;
      questions: Record<string, { type: string }>;
    };
    expect(payload.state).toBe(PROFILE);
    expect(Object.keys(payload.questions)).toEqual(sampleRubric.map((c) => c.id));
    expect(payload.questions.go?.type).toBe("choice");
    expect(payload.questions.seniority?.type).toBe("score");
    expect(body.output_config).toEqual({
      format: {
        type: "json_schema",
        schema: expect.objectContaining({ type: "object", required: ["answers"] }),
      },
    });
    expect(result.answers).toEqual([
      {
        criterionId: "go",
        result: "match",
        confidence: 0.91,
        excerpt: "Led the payments API in Go for four years.",
      },
    ]);
    expect(llm.calls).toBe(1);
  });

  it("maps a DefAPI-style object payload into the same result labels", async () => {
    const fetchImpl: typeof fetch = async () =>
      new Response(
        JSON.stringify({
          model: "claude-response-model",
          content: [
            {
              type: "text",
              text: '```json\n{"go":"no_evidence","seniority":"Above the target seniority in the question."}\n```',
            },
          ],
          usage: { input_tokens: 10, output_tokens: 20 },
        }),
        { status: 200 },
      );
    const llm = createLiveLlm({ apiKey: "test-key", model: MODEL_OPTION, fetchImpl });
    const result = await llm.compare({ approvedText: PROFILE, criteria: sampleRubric });
    expect(result.answers).toEqual([
      { criterionId: "go", result: "no_evidence", confidence: 0.5, excerpt: "" },
      { criterionId: "seniority", result: "above", confidence: 0.5, excerpt: "" },
    ]);
  });

  it("rejects compare when the text block is not json", async () => {
    const fetchImpl: typeof fetch = async () =>
      new Response(JSON.stringify(anthropicResponse("not json")), { status: 200 });
    const llm = createLiveLlm({ apiKey: "test-key", model: MODEL_OPTION, fetchImpl });
    await expect(llm.compare({ approvedText: PROFILE, criteria: sampleRubric })).rejects.toThrow("llm_failed");
  });

  it("rejects with llm_failed when fetch throws TimeoutError", async () => {
    const fetchImpl: typeof fetch = async () => {
      throw Object.assign(new Error("t"), { name: "TimeoutError" });
    };
    const llm = createLiveLlm({ apiKey: "test-key", model: MODEL_OPTION, fetchImpl });
    await expect(llm.draftRubric(NOTES)).rejects.toThrow("llm_failed");
  });
});
