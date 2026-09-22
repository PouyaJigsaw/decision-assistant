import { JEV_REQUEST_MODEL } from "./constants";
import type { ChoiceResult, Criterion } from "./types";

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
