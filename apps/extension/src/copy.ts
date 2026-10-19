import { CONFIDENCE_THRESHOLD, type ReasonCode } from "@decision-assistant/domain";

export const PRODUCT_NAME = "Who Fits?";

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

export function resultLabel(result: string): string {
  return RESULTS[result] ?? result;
}

export function certaintyCopy(confidence: number): string {
  const value = Math.min(1, Math.max(0, confidence)).toFixed(2);
  return confidence >= CONFIDENCE_THRESHOLD
    ? `Certain of this call · ${value}`
    : `Unsure of this call · ${value}`;
}

export function chipTone(result: string): "match" | "mismatch" | "no_evidence" {
  if (result === "match" || result === "aligned" || result === "above") return "match";
  if (result === "mismatch" || result === "below") return "mismatch";
  return "no_evidence";
}

export function resultMark(result: string): string {
  const tone = chipTone(result);
  if (tone === "match") return "✓";
  if (tone === "mismatch") return "×";
  return "–";
}

export function isCertain(confidence: number): boolean {
  return confidence >= CONFIDENCE_THRESHOLD;
}

export function isConfirmedMatch(result: string, confidence: number): boolean {
  return isCertain(confidence) && chipTone(result) === "match";
}

export function chipLabel(result: string, confidence: number): string {
  return `${resultLabel(result)} · ${confidence.toFixed(2)}`;
}

export function usesRemainingCopy(usesRemaining: number | null, cap: number | null = 3): string {
  if (usesRemaining == null || cap == null) return "Uses remaining: unlimited";
  return `Uses remaining: ${usesRemaining} of ${cap}`;
}

export function roleHeading(roleTitle?: string, company?: string): string {
  const role = roleTitle?.trim() ?? "";
  const companyName = company?.trim() ?? "";
  if (role && companyName) return `${role} · ${companyName}`;
  return role || companyName;
}

export function evaluatedForCopy(roleTitle?: string, candidateName?: string): string {
  const role = roleTitle?.trim();
  const name = candidateName?.trim();
  if (name && role) return `${name} · evaluated for ${role}`;
  if (role) return `Evaluated for ${role}`;
  return name ?? "";
}
