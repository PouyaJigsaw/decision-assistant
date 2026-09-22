import type { Criterion, TokenUsage } from "@decision-assistant/domain";

export interface JevClient {
  calls: number;
  evaluate(input: { state: string; questions: Record<string, unknown> }): Promise<
    | { ok: true; model: string; payload: unknown }
    | { ok: false; reason: "timeout" | "transport" }
  >;
}

export interface LlmClient {
  calls: number;
  draftRubric(notes: string): Promise<{
    model: string;
    criteria: { kind: Criterion["kind"]; label: string; prompt: string }[];
    usage: TokenUsage;
  }>;
  compare(input: { approvedText: string; criteria: Criterion[] }): Promise<{
    model: string;
    excerpts: { criterionId: string; excerpt: string }[];
    usage: TokenUsage;
  }>;
}
