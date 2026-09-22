import { z } from "zod";
import { CHOICE_OPTIONS, SENIORITY_LEVELS } from "./constants";

export const criterionSchema = z.object({
  id: z.string().min(1),
  kind: z.enum(["requirement", "preference", "disqualifier", "seniority"]),
  label: z.string().min(1),
  prompt: z.string().min(1),
});
export type Criterion = z.infer<typeof criterionSchema>;
export type ChoiceResult = (typeof CHOICE_OPTIONS)[number];
export type SeniorityResult = (typeof SENIORITY_LEVELS)[number];
export type Action = "contact" | "investigate" | "save_for_later" | "skip";
export type ReasonCode =
  | "missing_evidence"
  | "shaky_disqualifier"
  | "disqualifier_match"
  | "required_mismatch"
  | "seniority_mismatch"
  | "all_confident_matches"
  | "preference_shortfall";
export type CriterionAnswer = {
  criterionId: string;
  result: ChoiceResult | SeniorityResult;
  confidence: number;
  probabilities: Record<string, number>;
  excerpt: null;
};
export type PriceSnapshot = { inputUsdPerMillion: number; outputUsdPerMillion: number };
export type TokenUsage = { inputTokens: number; outputTokens: number };
export type Cost = { inputUsd: number; outputUsd: number; totalUsd: number };
