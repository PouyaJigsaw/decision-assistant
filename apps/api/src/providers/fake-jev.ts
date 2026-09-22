import type { JevClient } from "./types";

type JevResult = Awaited<ReturnType<JevClient["evaluate"]>>;

export class FakeJev implements JevClient {
  calls = 0;

  constructor(private readonly script: (input: Parameters<JevClient["evaluate"]>[0]) => JevResult | Promise<JevResult>) {}

  async evaluate(input: Parameters<JevClient["evaluate"]>[0]): Promise<JevResult> {
    this.calls += 1;
    return this.script(input);
  }
}
