import type { ReasonCode } from "@decision-assistant/domain";

const REASONS: Record<ReasonCode, string> = {
  missing_evidence: "A required qualification cannot be confirmed. Missing evidence is not treated as a mismatch.",
  shaky_disqualifier: "A disqualifier could not be confirmed.",
  disqualifier_match: "A disqualifier is a confident match.",
  required_mismatch: "A required criterion is a confident mismatch.",
  seniority_mismatch: "Demonstrated seniority is below the target.",
  all_confident_matches: "Every required criterion, seniority, and preference is a confident match.",
  preference_shortfall: "Required and seniority criteria match. At least one preference does not.",
};

const RESULTS: Record<string, string> = {
  match: "Match",
  mismatch: "Mismatch",
  no_evidence: "No evidence",
  contradictory: "Contradictory",
  below: "Below",
  aligned: "Aligned",
  above: "Above",
  unclear: "Unclear",
};

export function reasonCopy(reasonCode: ReasonCode): string {
  return REASONS[reasonCode];
}

export function chipLabel(result: string, confidence: number): string {
  return `${RESULTS[result] ?? result} · ${confidence.toFixed(2)}`;
}
