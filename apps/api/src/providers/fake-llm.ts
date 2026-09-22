import type { LlmClient } from "./types";

type DraftResult = Awaited<ReturnType<LlmClient["draftRubric"]>>;
type CompareResult = Awaited<ReturnType<LlmClient["compare"]>>;

export class FakeLlm implements LlmClient {
  calls = 0;

  constructor(
    private readonly script: {
      draftRubric?: (notes: string) => DraftResult | Promise<DraftResult>;
      compare?: (input: Parameters<LlmClient["compare"]>[0]) => CompareResult | Promise<CompareResult>;
    },
  ) {}

  async draftRubric(notes: string): Promise<DraftResult> {
    this.calls += 1;
    if (!this.script.draftRubric) throw new Error("not stubbed");
    return this.script.draftRubric(notes);
  }

  async compare(input: Parameters<LlmClient["compare"]>[0]): Promise<CompareResult> {
    this.calls += 1;
    if (!this.script.compare) throw new Error("not stubbed");
    return this.script.compare(input);
  }
}
