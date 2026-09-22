import { JEV_REQUEST_MODEL } from "@decision-assistant/domain";
import type { JevClient } from "./types";

const JEV_URL = "https://api.typesafe.ai/v1/systemone";

type JevResult = Awaited<ReturnType<JevClient["evaluate"]>>;

function isTimeout(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "name" in error &&
    (error.name === "TimeoutError" || error.name === "AbortError")
  );
}

function modelFrom(payload: unknown): string {
  if (typeof payload === "object" && payload !== null && !Array.isArray(payload) && "model" in payload) {
    const model = (payload as { model: unknown }).model;
    if (typeof model === "string") return model;
  }
  return "";
}

export function createLiveJev(opts: { apiKey: string; fetchImpl?: typeof fetch }): JevClient {
  const fetchImpl = opts.fetchImpl ?? fetch;
  return {
    calls: 0,
    async evaluate(input): Promise<JevResult> {
      this.calls += 1;
      try {
        const response = await fetchImpl(JEV_URL, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${opts.apiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model: JEV_REQUEST_MODEL,
            state: input.state,
            questions: input.questions,
          }),
          signal: AbortSignal.timeout(10_000),
        });
        if (!response.ok) return { ok: false, reason: "transport" };
        let payload: unknown;
        try {
          payload = JSON.parse(await response.text());
        } catch {
          return { ok: false, reason: "transport" };
        }
        return { ok: true, model: modelFrom(payload), payload };
      } catch (error) {
        if (isTimeout(error)) return { ok: false, reason: "timeout" };
        return { ok: false, reason: "transport" };
      }
    },
  };
}
