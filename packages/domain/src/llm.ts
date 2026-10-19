import { CHOICE_OPTIONS, SENIORITY_LEVELS } from "./constants";
import { toJevRequest } from "./jev";
import type { Criterion } from "./types";

const KINDS = new Set<Criterion["kind"]>(["requirement", "preference", "disqualifier", "seniority"]);
const RESULTS = new Set<string>([...CHOICE_OPTIONS, ...SENIORITY_LEVELS]);

export const DRAFT_INSTRUCTIONS =
  'Return only JSON: {"criteria":[{"kind":"requirement"|"preference"|"disqualifier"|"seniority","label":"short name","prompt":"one question"}]}. Include at least one requirement and at most one seniority. Do not include protected traits.';

export const COMPARE_INSTRUCTIONS =
  'Return only JSON: {"answers":[{"criterionId":"id","result":"match"|"mismatch"|"no_evidence"|"contradictory"|"below"|"aligned"|"above"|"unclear","confidence":0-1,"excerpt":"contiguous quote or empty string"}]}. Answer every question. Quote only text that appears in the profile.';

export const COMPARE_JSON_SCHEMA = {
  type: "object",
  properties: {
    answers: {
      type: "array",
      items: {
        type: "object",
        properties: {
          criterionId: { type: "string" },
          result: { type: "string", enum: [...CHOICE_OPTIONS, ...SENIORITY_LEVELS] },
          confidence: { type: "number" },
          excerpt: { type: "string" },
        },
        required: ["criterionId", "result", "confidence", "excerpt"],
        additionalProperties: false,
      },
    },
  },
  required: ["answers"],
  additionalProperties: false,
};

export type LlmRequest = { instructions: string; input: string };

export type DraftedCriterion = { kind: Criterion["kind"]; label: string; prompt: string };

export type CompareAnswer = {
  criterionId: string;
  result: string;
  confidence: number;
  excerpt: string;
};

export function draftLlmRequest(notes: string): LlmRequest {
  return { instructions: DRAFT_INSTRUCTIONS, input: notes };
}

export function compareLlmRequest(criteria: Criterion[], approvedText: string): LlmRequest {
  const { state, questions } = toJevRequest(criteria, approvedText);
  return { instructions: COMPARE_INSTRUCTIONS, input: JSON.stringify({ state, questions }) };
}

export function unwrapJsonText(text: string): string {
  let s = text.trim();
  if (s.startsWith("```json")) s = s.slice("```json".length).trimStart();
  else if (s.startsWith("```")) s = s.slice(3).trimStart();
  if (s.endsWith("```")) s = s.slice(0, -3).trimEnd();
  return s;
}

function parseJsonObject(text: string): Record<string, unknown> | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(unwrapJsonText(text));
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return null;
  return parsed as Record<string, unknown>;
}

export function parseDraftCompletion(
  text: string,
): { ok: true; criteria: DraftedCriterion[] } | { ok: false } {
  const parsed = parseJsonObject(text);
  if (!parsed || !Array.isArray(parsed.criteria)) return { ok: false };
  const mapped: DraftedCriterion[] = [];
  for (const item of parsed.criteria) {
    if (typeof item !== "object" || item === null) return { ok: false };
    const row = item as { kind?: unknown; label?: unknown; prompt?: unknown };
    if (typeof row.kind !== "string" || !KINDS.has(row.kind as Criterion["kind"])) return { ok: false };
    if (typeof row.label !== "string" || typeof row.prompt !== "string") return { ok: false };
    mapped.push({ kind: row.kind as Criterion["kind"], label: row.label, prompt: row.prompt });
  }
  return { ok: true, criteria: mapped };
}

function allowedResults(kind: Criterion["kind"]): readonly string[] {
  return kind === "seniority" ? SENIORITY_LEVELS : CHOICE_OPTIONS;
}

function normalizeResult(raw: string, kind?: Criterion["kind"]): string | null {
  const result = raw.trim();
  if (RESULTS.has(result) && (!kind || allowedResults(kind).includes(result))) return result;
  const lower = result.toLowerCase();
  if (kind === "seniority" || SENIORITY_LEVELS.some((level) => lower.includes(level))) {
    const hit = SENIORITY_LEVELS.find((level) => lower.includes(level));
    return hit ?? null;
  }
  const hit = CHOICE_OPTIONS.find(
    (option) => lower.includes(option.replace("_", " ")) || lower.includes(option),
  );
  return hit ?? null;
}

function asAnswer(
  criterionId: string,
  result: string,
  confidence: number,
  excerpt: string,
  criteria: Criterion[],
): CompareAnswer | null {
  const criterion = criteria.find((item) => item.id === criterionId);
  const normalized = normalizeResult(result, criterion?.kind);
  if (!normalized) return null;
  if (!Number.isFinite(confidence) || confidence < 0 || confidence > 1) return null;
  return { criterionId, result: normalized, confidence, excerpt };
}

export function parseCompareCompletion(
  text: string,
  criteria: Criterion[],
): { ok: true; answers: CompareAnswer[] } | { ok: false } {
  const parsed = parseJsonObject(text);
  if (!parsed) return { ok: false };
  const raw = parsed.answers ?? parsed;
  const mapped: CompareAnswer[] = [];
  if (Array.isArray(raw)) {
    for (const item of raw) {
      if (typeof item !== "object" || item === null) continue;
      const row = item as {
        criterionId?: unknown;
        result?: unknown;
        choice?: unknown;
        confidence?: unknown;
        excerpt?: unknown;
      };
      const result = typeof row.result === "string" ? row.result : typeof row.choice === "string" ? row.choice : "";
      if (typeof row.criterionId !== "string" || !result) continue;
      const answer = asAnswer(
        row.criterionId,
        result,
        typeof row.confidence === "number" ? row.confidence : 0.5,
        typeof row.excerpt === "string" ? row.excerpt : "",
        criteria,
      );
      if (answer) mapped.push(answer);
    }
  } else if (typeof raw === "object" && raw !== null) {
    for (const [criterionId, item] of Object.entries(raw)) {
      if (typeof item === "string") {
        const answer = asAnswer(criterionId, item, 0.5, "", criteria);
        if (answer) mapped.push(answer);
        continue;
      }
      if (typeof item !== "object" || item === null) continue;
      const row = item as { result?: unknown; choice?: unknown; confidence?: unknown; excerpt?: unknown };
      const result = typeof row.result === "string" ? row.result : typeof row.choice === "string" ? row.choice : "";
      if (!result) continue;
      const answer = asAnswer(
        criterionId,
        result,
        typeof row.confidence === "number" ? row.confidence : 0.5,
        typeof row.excerpt === "string" ? row.excerpt : "",
        criteria,
      );
      if (answer) mapped.push(answer);
    }
  } else {
    return { ok: false };
  }
  return { ok: true, answers: mapped };
}
