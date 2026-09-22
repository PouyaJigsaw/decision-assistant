import type { Criterion } from "./types";

const TERMS: ReadonlyArray<readonly [RegExp, string]> = [
  [/\brace\b/i, "race"],
  [/\bracial\b/i, "racial"],
  [/\bethnicity\b/i, "ethnicity"],
  [/\bethnic\b/i, "ethnic"],
  [/\breligion\b/i, "religion"],
  [/\breligious\b/i, "religious"],
  [/\bgender\b/i, "gender"],
  [/\bsexual orientation\b/i, "sexual orientation"],
  [/\bage\b/i, "age"],
  [/\bdisability\b/i, "disability"],
  [/\bdisabled\b/i, "disabled"],
  [/\bhealth\b/i, "health"],
  [/\bfamily\b/i, "family"],
  [/\bpregnancy\b/i, "pregnancy"],
  [/\bpregnant\b/i, "pregnant"],
  [/\bpolitics\b/i, "politics"],
  [/\bpolitical\b/i, "political"],
  [/\bpersonality\b/i, "personality"],
  [/\bcultural fit\b/i, "cultural fit"],
  [/\bculture fit\b/i, "culture fit"],
];

export function scanSafety(text: string): { ok: true } | { ok: false; term: string } {
  for (const [pattern, term] of TERMS) {
    if (pattern.test(text)) return { ok: false, term };
  }
  return { ok: true };
}

export type ValidateRubricResult =
  | { ok: true }
  | {
      ok: false;
      reason: "safety" | "empty_requirement" | "duplicate_id" | "duplicate_seniority" | "empty_text";
      term?: string;
    };

export function validateRubric(criteria: Criterion[]): ValidateRubricResult {
  for (const criterion of criteria) {
    if (!criterion.id.trim() || !criterion.label.trim() || !criterion.prompt.trim()) {
      return { ok: false, reason: "empty_text" };
    }
  }

  const ids = new Set<string>();
  for (const criterion of criteria) {
    if (ids.has(criterion.id)) return { ok: false, reason: "duplicate_id" };
    ids.add(criterion.id);
  }

  if (criteria.filter((c) => c.kind === "seniority").length > 1) {
    return { ok: false, reason: "duplicate_seniority" };
  }

  if (!criteria.some((c) => c.kind === "requirement")) {
    return { ok: false, reason: "empty_requirement" };
  }

  for (const criterion of criteria) {
    const scan = scanSafety(`${criterion.label}\n${criterion.prompt}`);
    if (!scan.ok) return { ok: false, reason: "safety", term: scan.term };
  }

  return { ok: true };
}
