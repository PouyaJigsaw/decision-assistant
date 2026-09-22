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
    criteria: { kind: string; label: string; prompt: string }[];
    usage: { inputTokens: number; outputTokens: number };
  }>;
  compare(input: {
    approvedText: string;
    criteria: { id: string; kind: string; label: string; prompt: string }[];
  }): Promise<{
    model: string;
    excerpts: { criterionId: string; excerpt: string }[];
    usage: { inputTokens: number; outputTokens: number };
  }>;
}
