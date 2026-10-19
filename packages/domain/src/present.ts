import { CONFIDENCE_THRESHOLD } from "./constants";
import type { Criterion } from "./types";

export type PresentedAnswer = {
  label: string;
  detail: string | null;
  tone: "match" | "mismatch" | "no_evidence";
  uncertain: boolean;
};

const SENIORITY_LABELS: Record<string, { label: string; tone: PresentedAnswer["tone"] }> = {
  below: { label: "Below target", tone: "mismatch" },
  aligned: { label: "Aligned", tone: "match" },
  above: { label: "Above target", tone: "match" },
  unclear: { label: "Unclear", tone: "no_evidence" },
};

function confident(confidence: number): boolean {
  return confidence >= CONFIDENCE_THRESHOLD && confidence <= 1;
}

export function presentAnswer(input: {
  kind?: Criterion["kind"];
  result: string;
  confidence: number;
}): PresentedAnswer {
  if (input.kind === "seniority") {
    const level = SENIORITY_LABELS[input.result] ?? {
      label: input.result,
      tone: "no_evidence" as const,
    };
    const uncertain = input.result === "unclear" || !confident(input.confidence);
    return {
      label: level.label,
      detail: !confident(input.confidence) ? "The evidence is inconclusive." : null,
      tone: level.tone,
      uncertain,
    };
  }

  if (input.result === "no_evidence") {
    return {
      label: "Not sure",
      detail: "Not mentioned in the profile.",
      tone: "no_evidence",
      uncertain: true,
    };
  }
  if (input.result === "contradictory") {
    return {
      label: "Not sure",
      detail: "The profile contains conflicting information.",
      tone: "no_evidence",
      uncertain: true,
    };
  }
  if (!confident(input.confidence) && (input.result === "match" || input.result === "mismatch")) {
    return {
      label: "Not sure",
      detail: "The evidence is inconclusive.",
      tone: "no_evidence",
      uncertain: true,
    };
  }
  if (input.result === "match") {
    if (input.kind === "disqualifier") {
      return {
        label: "Yes",
        detail: "The exclusion condition is present.",
        tone: "mismatch",
        uncertain: false,
      };
    }
    return { label: "Yes", detail: null, tone: "match", uncertain: false };
  }
  if (input.result === "mismatch") {
    return { label: "No", detail: null, tone: "mismatch", uncertain: false };
  }
  return { label: input.result, detail: null, tone: "no_evidence", uncertain: true };
}

const EVIDENCE_MARKER = "Evidence to look for:";

export function splitScreeningPrompt(prompt: string): { question: string; evidence: string | null } {
  const index = prompt.indexOf(EVIDENCE_MARKER);
  if (index === -1) return { question: prompt.trim(), evidence: null };
  return {
    question: prompt.slice(0, index).trim(),
    evidence: prompt.slice(index).trim(),
  };
}
