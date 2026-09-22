import { TRIAL_SUCCESS_CAP } from "./constants";

export function preflight(input: {
  evaluationsEnabled: boolean;
  successCount: number;
}):
  | { proceed: true }
  | { proceed: false; reason: "kill_switch" | "trial_cap"; countsAsUse: false; completedRefusal: boolean } {
  if (!input.evaluationsEnabled) {
    return { proceed: false, reason: "kill_switch", countsAsUse: false, completedRefusal: false };
  }
  if (input.successCount >= TRIAL_SUCCESS_CAP) {
    return { proceed: false, reason: "trial_cap", countsAsUse: false, completedRefusal: true };
  }
  return { proceed: true };
}

export function countsAsUse(input: { jevValid: boolean; idempotencyReplay: boolean }): boolean {
  return input.jevValid && !input.idempotencyReplay;
}

export function usesRemaining(successCount: number): number {
  return Math.max(0, TRIAL_SUCCESS_CAP - successCount);
}

export function normalizeText(text: string): string {
  return text.trim().replace(/\s+/g, " ");
}

export function groundExcerpt(
  approvedText: string,
  excerpt: string,
): { grounded: true; excerpt: string } | { grounded: false; excerpt: null } {
  const needle = normalizeText(excerpt);
  if (!needle) return { grounded: false, excerpt: null };
  if (normalizeText(approvedText).includes(needle)) return { grounded: true, excerpt: needle };
  return { grounded: false, excerpt: null };
}
