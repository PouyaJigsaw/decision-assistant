import {
  CHOICE_OPTIONS,
  JEV_REQUEST_MODEL,
  SENIORITY_LEVELS,
  VERSIONED_JEV_MODEL,
} from "./constants";
import type { ChoiceResult, Criterion, CriterionAnswer, SeniorityResult, TokenUsage } from "./types";

const CHOICE_CRITERIA: Record<ChoiceResult, string> = {
  match: "The approved profile supports this criterion.",
  mismatch: "The approved profile contradicts this criterion.",
  no_evidence: "The approved profile does not contain evidence for this criterion.",
  contradictory: "The approved profile contains evidence for and against this criterion.",
};

const SENIORITY_CRITERIA: [string, string, string, string] = [
  "Below the target seniority in the question.",
  "Aligned with the target seniority in the question.",
  "Above the target seniority in the question.",
  "Unclear: the profile does not support a seniority placement.",
];

export type JevChoiceQuestion = {
  type: "choice";
  instructions: string;
  criteria: Record<ChoiceResult, string>;
};

export type JevScoreQuestion = {
  type: "score";
  instructions: string;
  criteria: [string, string, string, string];
};

export type JevQuestion = JevChoiceQuestion | JevScoreQuestion;

export function toJevRequest(criteria: Criterion[], approvedText: string): {
  model: typeof JEV_REQUEST_MODEL;
  state: string;
  questions: Record<string, JevQuestion>;
} {
  const questions: Record<string, JevQuestion> = {};
  for (const criterion of criteria) {
    if (criterion.kind === "seniority") {
      questions[criterion.id] = {
        type: "score",
        instructions: criterion.prompt,
        criteria: SENIORITY_CRITERIA,
      };
    } else {
      questions[criterion.id] = {
        type: "choice",
        instructions: criterion.prompt,
        criteria: CHOICE_CRITERIA,
      };
    }
  }
  return { model: JEV_REQUEST_MODEL, state: approvedText, questions };
}

export type ParseJevResult =
  | { ok: true; model: string; answers: CriterionAnswer[]; usage: TokenUsage }
  | { ok: false; reason: "invalid_jev" };

const invalid: ParseJevResult = { ok: false, reason: "invalid_jev" };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonNegInt(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

function inUnitInterval(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1;
}

function isChoiceResult(value: unknown): value is ChoiceResult {
  return typeof value === "string" && (CHOICE_OPTIONS as readonly string[]).includes(value);
}

function parseChoiceAnswer(id: string, raw: unknown): CriterionAnswer | null {
  if (!isRecord(raw) || raw.type !== "choice" || !isChoiceResult(raw.choice) || !inUnitInterval(raw.confidence)) {
    return null;
  }
  if (!isRecord(raw.probabilities)) return null;
  const probabilities: Record<string, number> = {};
  for (const option of CHOICE_OPTIONS) {
    const p = raw.probabilities[option];
    if (!inUnitInterval(p)) return null;
    probabilities[option] = p;
  }
  return { criterionId: id, result: raw.choice, confidence: raw.confidence, probabilities, excerpt: null };
}

function parseScoreAnswer(id: string, raw: unknown): CriterionAnswer | null {
  if (!isRecord(raw) || raw.type !== "score" || !inUnitInterval(raw.confidence)) return null;
  if (!isRecord(raw.probabilities)) return null;
  const keyed: Record<string, number> = {};
  let win = 0;
  for (let i = 0; i < SENIORITY_LEVELS.length; i++) {
    const p = raw.probabilities[String(i)];
    if (!inUnitInterval(p)) return null;
    const level = SENIORITY_LEVELS[i];
    if (level === undefined) return null;
    keyed[level] = p;
    const best = raw.probabilities[String(win)];
    if (typeof best === "number" && p > best) win = i;
  }
  const result = SENIORITY_LEVELS[win] as SeniorityResult;
  return { criterionId: id, result, confidence: raw.confidence, probabilities: keyed, excerpt: null };
}

export function parseJevResponse(criteria: Criterion[], payload: unknown): ParseJevResult {
  if (!isRecord(payload) || typeof payload.model !== "string" || !VERSIONED_JEV_MODEL.test(payload.model)) {
    return invalid;
  }
  if (!isRecord(payload.answers) || !isRecord(payload.usage)) return invalid;
  if (!isNonNegInt(payload.usage.input_tokens) || !isNonNegInt(payload.usage.output_tokens)) {
    return invalid;
  }

  const ids = criteria.map((c) => c.id);
  const answerIds = Object.keys(payload.answers);
  if (answerIds.length !== ids.length || ids.some((id) => !answerIds.includes(id))) {
    return invalid;
  }

  const answers: CriterionAnswer[] = [];
  for (const criterion of criteria) {
    const raw = payload.answers[criterion.id];
    const parsed =
      criterion.kind === "seniority"
        ? parseScoreAnswer(criterion.id, raw)
        : parseChoiceAnswer(criterion.id, raw);
    if (!parsed) return invalid;
    answers.push(parsed);
  }

  return {
    ok: true,
    model: payload.model,
    answers,
    usage: { inputTokens: payload.usage.input_tokens, outputTokens: payload.usage.output_tokens },
  };
}
