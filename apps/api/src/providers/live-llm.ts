import type { Criterion } from "@decision-assistant/domain";
import type { LlmClient } from "./types";

const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";
const KINDS = new Set<Criterion["kind"]>(["requirement", "preference", "disqualifier", "seniority"]);

const DRAFT_SYSTEM =
  'Return only JSON: {"criteria":[{"kind":"requirement"|"preference"|"disqualifier"|"seniority","label":"short name","prompt":"one question"}]}. Include at least one requirement and at most one seniority. Do not include protected traits.';
const COMPARE_SYSTEM =
  'Return only JSON: {"answers":[{"criterionId":"id","excerpt":"a contiguous quote from the profile or an empty string"}]}. Quote only text that appears in the profile. Do not decide an action.';

type DraftResult = Awaited<ReturnType<LlmClient["draftRubric"]>>;
type CompareResult = Awaited<ReturnType<LlmClient["compare"]>>;

function llmFailed(): never {
  throw new Error("llm_failed");
}

function unwrapJsonText(text: string): string {
  let s = text.trim();
  if (s.startsWith("```json")) s = s.slice("```json".length).trimStart();
  if (s.endsWith("```")) s = s.slice(0, -3).trimEnd();
  return s;
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

function parseJsonObject(text: string): Record<string, unknown> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(unwrapJsonText(text));
  } catch {
    llmFailed();
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) llmFailed();
  return parsed as Record<string, unknown>;
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
  const parsed = parseJsonObject(firstTextBlock(payload));
  const criteria = parsed.criteria;
  if (!Array.isArray(criteria)) llmFailed();
  const mapped = criteria.map((item) => {
    if (typeof item !== "object" || item === null) llmFailed();
    const row = item as { kind?: unknown; label?: unknown; prompt?: unknown };
    if (typeof row.kind !== "string" || !KINDS.has(row.kind as Criterion["kind"])) llmFailed();
    if (typeof row.label !== "string" || typeof row.prompt !== "string") llmFailed();
    return { kind: row.kind as Criterion["kind"], label: row.label, prompt: row.prompt };
  });
  const meta = usageAndModel(payload);
  return { model: meta.model, criteria: mapped, usage: meta.usage };
}

function parseCompare(payload: unknown): CompareResult {
  const parsed = parseJsonObject(firstTextBlock(payload));
  const answers = parsed.answers;
  if (!Array.isArray(answers)) llmFailed();
  const excerpts = answers.map((item) => {
    if (typeof item !== "object" || item === null) llmFailed();
    const row = item as { criterionId?: unknown; excerpt?: unknown };
    if (typeof row.criterionId !== "string" || typeof row.excerpt !== "string") llmFailed();
    return { criterionId: row.criterionId, excerpt: row.excerpt };
  });
  const meta = usageAndModel(payload);
  return { model: meta.model, excerpts, usage: meta.usage };
}

function compareUserContent(input: { approvedText: string; criteria: Criterion[] }): string {
  const lines = input.criteria.map((c) => `${c.id} [${c.kind}] ${c.prompt}`);
  return `Profile:\n${input.approvedText}\n\nCriteria:\n${lines.join("\n")}`;
}

export function createLiveLlm(opts: { apiKey: string; model: string; fetchImpl?: typeof fetch }): LlmClient {
  const fetchImpl = opts.fetchImpl ?? fetch;

  async function complete(system: string, user: string): Promise<unknown> {
    try {
      const response = await fetchImpl(ANTHROPIC_URL, {
        method: "POST",
        headers: {
          "x-api-key": opts.apiKey,
          "anthropic-version": "2023-06-01",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          model: opts.model,
          max_tokens: 2000,
          system,
          messages: [{ role: "user", content: user }],
        }),
        signal: AbortSignal.timeout(10_000),
      });
      if (!response.ok) llmFailed();
      try {
        return JSON.parse(await response.text()) as unknown;
      } catch {
        llmFailed();
      }
    } catch {
      llmFailed();
    }
  }

  return {
    calls: 0,
    async draftRubric(notes) {
      this.calls += 1;
      return parseDraft(await complete(DRAFT_SYSTEM, notes));
    },
    async compare(input) {
      this.calls += 1;
      return parseCompare(await complete(COMPARE_SYSTEM, compareUserContent(input)));
    },
  };
}
