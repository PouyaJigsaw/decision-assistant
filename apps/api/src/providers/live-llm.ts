import {
  COMPARE_JSON_SCHEMA,
  DRAFT_INSTRUCTIONS,
  compareLlmRequest,
  parseCompareCompletion,
  parseDraftCompletion,
  type Criterion,
} from "@decision-assistant/domain";
import type { LlmClient } from "./types";

const DEFAPI_URL = "https://api.defapi.org/api/v1/messages";
const LLM_TIMEOUT_MS = 45_000;

type DraftResult = Awaited<ReturnType<LlmClient["draftRubric"]>>;
type CompareResult = Awaited<ReturnType<LlmClient["compare"]>>;

function llmFailed(): never {
  throw new Error("llm_failed");
}

function firstTextBlock(payload: unknown): string {
  if (typeof payload !== "object" || payload === null || !("content" in payload)) llmFailed();
  const content = (payload as { content: unknown }).content;
  if (!Array.isArray(content)) llmFailed();
  const block = content.find(
    (item) => typeof item === "object" && item !== null && "type" in item && item.type === "text",
  );
  if (typeof block !== "object" || block === null || !("text" in block) || typeof block.text !== "string") {
    llmFailed();
  }
  return block.text;
}

function usageAndModel(payload: unknown): { model: string; usage: { inputTokens: number; outputTokens: number } } {
  if (typeof payload !== "object" || payload === null) llmFailed();
  const record = payload as { model?: unknown; usage?: unknown };
  if (typeof record.model !== "string") llmFailed();
  if (typeof record.usage !== "object" || record.usage === null) llmFailed();
  const usage = record.usage as { input_tokens?: unknown; output_tokens?: unknown };
  const inputTokens = usage.input_tokens;
  const outputTokens = usage.output_tokens;
  if (typeof inputTokens !== "number" || !Number.isFinite(inputTokens)) llmFailed();
  if (typeof outputTokens !== "number" || !Number.isFinite(outputTokens)) llmFailed();
  return { model: record.model, usage: { inputTokens, outputTokens } };
}

function parseDraft(payload: unknown): DraftResult {
  const parsed = parseDraftCompletion(firstTextBlock(payload));
  if (!parsed.ok) llmFailed();
  const meta = usageAndModel(payload);
  return { model: meta.model, criteria: parsed.criteria, usage: meta.usage };
}

function parseCompare(payload: unknown, criteria: Criterion[]): CompareResult {
  const parsed = parseCompareCompletion(firstTextBlock(payload), criteria);
  if (!parsed.ok) llmFailed();
  const meta = usageAndModel(payload);
  return { model: meta.model, answers: parsed.answers, usage: meta.usage };
}

export function createLiveLlm(opts: { apiKey: string; model: string; fetchImpl?: typeof fetch }): LlmClient {
  const fetchImpl = opts.fetchImpl ?? fetch;

  async function complete(system: string, user: string, extra: Record<string, unknown> = {}): Promise<unknown> {
    try {
      const response = await fetchImpl(DEFAPI_URL, {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
          Authorization: `Bearer ${opts.apiKey}`,
        },
        body: JSON.stringify({
          model: opts.model,
          system,
          messages: [{ role: "user", content: user }],
          ...extra,
        }),
        signal: AbortSignal.timeout(LLM_TIMEOUT_MS),
      });
      if (!response.ok) {
        console.error("live-llm failed", { reason: "http", status: response.status });
        llmFailed();
      }
      try {
        return JSON.parse(await response.text()) as unknown;
      } catch {
        console.error("live-llm failed", { reason: "invalid_json" });
        llmFailed();
      }
    } catch (error) {
      const name = error instanceof Error ? error.name : "Error";
      const reason = name === "TimeoutError" || name === "AbortError" ? "timeout" : "transport";
      console.error("live-llm failed", { reason });
      llmFailed();
    }
  }

  return {
    calls: 0,
    async draftRubric(notes) {
      this.calls += 1;
      const request = { instructions: DRAFT_INSTRUCTIONS, input: notes };
      return parseDraft(await complete(request.instructions, request.input));
    },
    async compare(input) {
      this.calls += 1;
      const request = compareLlmRequest(input.criteria, input.approvedText);
      return parseCompare(
        await complete(request.instructions, request.input, {
          output_config: { format: { type: "json_schema", schema: COMPARE_JSON_SCHEMA } },
        }),
        input.criteria,
      );
    },
  };
}
