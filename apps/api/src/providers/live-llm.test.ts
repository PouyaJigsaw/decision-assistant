import { sampleRubric } from "@decision-assistant/domain";
import { describe, expect, it } from "vitest";
import { createLiveLlm } from "./live-llm";

const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";
const MODEL_OPTION = "claude-sonnet-4-20250514";
const NOTES = "Need five years of Go.";
const PROFILE = "Staff engineer. Led the payments API in Go for four years.";

const DRAFT_SYSTEM =
  'Return only JSON: {"criteria":[{"kind":"requirement"|"preference"|"disqualifier"|"seniority","label":"short name","prompt":"one question"}]}. Include at least one requirement and at most one seniority. Do not include protected traits.';
const COMPARE_SYSTEM =
  'Return only JSON: {"answers":[{"criterionId":"id","excerpt":"a contiguous quote from the profile or an empty string"}]}. Quote only text that appears in the profile. Do not decide an action.';

const DRAFT_TEXT = '{"criteria":[{"kind":"requirement","label":"Go","prompt":"Five years of Go?"}]}';
const COMPARE_TEXT = '{"answers":[{"criterionId":"go","excerpt":"Led the payments API in Go for four years."}]}';

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
    expect(recorded[0]?.url).toBe(ANTHROPIC_URL);
    const init = recorded[0]?.init;
    expect(init?.method).toBe("POST");
    expect(init?.signal).toBeInstanceOf(AbortSignal);
    const headers = new Headers(init?.headers);
    expect(headers.get("x-api-key")).toBe("test-key");
    expect(headers.get("anthropic-version")).toBe("2023-06-01");
    expect(headers.get("content-type")).toBe("application/json");
    const body = JSON.parse(String(init?.body)) as {
      model: string;
      max_tokens: number;
      system: string;
      messages: { role: string; content: string }[];
    };
    expect(body.model).toBe(MODEL_OPTION);
    expect(body.max_tokens).toBe(2000);
    expect(body.system).toBe(DRAFT_SYSTEM);
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
    };
    expect(body.system).toBe(COMPARE_SYSTEM);
    expect(body.messages[0]?.content).toBe(
      [
        "Profile:",
        PROFILE,
        "",
        "Criteria:",
        ...sampleRubric.map((c) => `${c.id} [${c.kind}] ${c.prompt}`),
      ].join("\n"),
    );
    expect(result.excerpts[0]?.excerpt).toBe("Led the payments API in Go for four years.");
    expect(result.excerpts).toEqual([
      { criterionId: "go", excerpt: "Led the payments API in Go for four years." },
    ]);
    expect(llm.calls).toBe(1);
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
