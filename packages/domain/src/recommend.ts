import { CONFIDENCE_THRESHOLD, POLICY_VERSION } from "./constants";
import type { Action, Criterion, CriterionAnswer, ReasonCode } from "./types";

function confident(answer: CriterionAnswer): boolean {
  return answer.confidence >= CONFIDENCE_THRESHOLD && answer.confidence <= 1;
}

function isMatch(criterion: Criterion, answer: CriterionAnswer): boolean {
  if (criterion.kind === "seniority") return answer.result === "aligned" || answer.result === "above";
  return answer.result === "match";
}

function isRequiredUnconfirmed(criterion: Criterion, answer: CriterionAnswer): boolean {
  if (criterion.kind !== "requirement" && criterion.kind !== "seniority") return false;
  if (!confident(answer)) return true;
  if (answer.result === "no_evidence" || answer.result === "contradictory") return true;
  return criterion.kind === "seniority" && answer.result === "unclear";
}

function isShakyDisqualifier(criterion: Criterion, answer: CriterionAnswer): boolean {
  if (criterion.kind !== "disqualifier") return false;
  if (answer.result === "no_evidence") return false;
  if (answer.result === "contradictory") return true;
  return !confident(answer);
}

function weight(kind: Criterion["kind"]): number {
  if (kind === "disqualifier") return 0;
  if (kind === "preference") return 0.5;
  return 1;
}

export function recommend(
  criteria: Criterion[],
  answers: CriterionAnswer[],
): { action: Action; score: number; policyVersion: 1; reasonCode: ReasonCode } {
  const byId = new Map(answers.map((a) => [a.criterionId, a]));
  const rows = criteria.map((criterion) => {
    const answer = byId.get(criterion.id);
    if (!answer) throw new Error(`missing answer for ${criterion.id}`);
    return { criterion, answer };
  });

  let action: Action;
  let reasonCode: ReasonCode;

  const unconfirmedRequired = rows.find(({ criterion, answer }) => isRequiredUnconfirmed(criterion, answer));
  const shakyDisqualifier = rows.find(({ criterion, answer }) => isShakyDisqualifier(criterion, answer));
  if (unconfirmedRequired || shakyDisqualifier) {
    action = "investigate";
    reasonCode = unconfirmedRequired ? "missing_evidence" : "shaky_disqualifier";
  } else {
    const disqualifierHit = rows.find(
      ({ criterion, answer }) => criterion.kind === "disqualifier" && confident(answer) && answer.result === "match",
    );
    const requiredHit = rows.find(
      ({ criterion, answer }) =>
        criterion.kind === "requirement" && confident(answer) && answer.result === "mismatch",
    );
    const seniorityHit = rows.find(
      ({ criterion, answer }) => criterion.kind === "seniority" && confident(answer) && answer.result === "below",
    );
    if (disqualifierHit || requiredHit || seniorityHit) {
      action = "skip";
      reasonCode = disqualifierHit
        ? "disqualifier_match"
        : requiredHit
          ? "required_mismatch"
          : "seniority_mismatch";
    } else {
      const preferenceShort = rows.some(
        ({ criterion, answer }) => criterion.kind === "preference" && !(confident(answer) && isMatch(criterion, answer)),
      );
      if (preferenceShort) {
        action = "save_for_later";
        reasonCode = "preference_shortfall";
      } else {
        action = "contact";
        reasonCode = "all_confident_matches";
      }
    }
  }

  let possible = 0;
  let earned = 0;
  for (const { criterion, answer } of rows) {
    const w = weight(criterion.kind);
    if (w === 0) continue;
    possible += w;
    if (confident(answer) && isMatch(criterion, answer)) earned += w;
  }

  return {
    action,
    score: Math.round((100 * earned) / possible),
    policyVersion: POLICY_VERSION,
    reasonCode,
  };
}
