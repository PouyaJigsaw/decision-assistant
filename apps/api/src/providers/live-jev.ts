import { JEV_REQUEST_MODEL } from "@decision-assistant/domain";
import type { JevClient } from "./types";

const JEV_URL = "https://api.defapi.org/api/v1/decisions";
const JEV_TIMEOUT_MS = 45_000;

type JevResult = Awaited<ReturnType<JevClient["evaluate"]>>;

function isTimeout(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "name" in error &&
    (error.name === "TimeoutError" || error.name === "AbortError")
  );
}

function versionedJevModel(raw: string): string {
  const match = raw.match(/jev-(\d+)\.(\d+)(?:\.(\d+)|-(\d+))?/);
  if (!match) return raw;
  const patch = match[3] ?? match[4] ?? "0";
  return `jev-${match[1]}.${match[2]}.${patch}`;
}

function modelFrom(payload: unknown): string {
  if (typeof payload === "object" && payload !== null && !Array.isArray(payload) && "model" in payload) {
    const model = (payload as { model: unknown }).model;
    if (typeof model === "string") return versionedJevModel(model);
  }
  return "";
}

function withVersionedModel(payload: unknown): unknown {
  if (typeof payload !== "object" || payload === null || Array.isArray(payload) || !("model" in payload)) {
    return payload;
  }
  const model = (payload as { model: unknown }).model;
  if (typeof model !== "string") return payload;
  return { ...payload, model: versionedJevModel(model) };
}

export function createLiveJev(opts: { apiKey: string; model?: string; fetchImpl?: typeof fetch }): JevClient {
  const fetchImpl = opts.fetchImpl ?? fetch;
  return {
    calls: 0,
    async evaluate(input): Promise<JevResult> {
      this.calls += 1;
      try {
        const response = await fetchImpl(JEV_URL, {
          method: "POST",
          headers: {
            Accept: "application/json",
            "Content-Type": "application/json",
            Authorization: `Bearer ${opts.apiKey}`,
          },
          body: JSON.stringify({
            model: opts.model ?? JEV_REQUEST_MODEL,
            state: input.state,
            questions: input.questions,
          }),
          signal: AbortSignal.timeout(JEV_TIMEOUT_MS),
        });
        if (!response.ok) {
          console.error("live-jev failed", { reason: "http", status: response.status });
          return { ok: false, reason: "transport" };
        }
        let payload: unknown;
        try {
          payload = withVersionedModel(JSON.parse(await response.text()));
        } catch {
          console.error("live-jev failed", { reason: "invalid_json" });
          return { ok: false, reason: "transport" };
        }
        return { ok: true, model: modelFrom(payload), payload };
      } catch (error) {
        if (isTimeout(error)) {
          console.error("live-jev failed", { reason: "timeout" });
          return { ok: false, reason: "timeout" };
        }
        console.error("live-jev failed", { reason: "transport" });
        return { ok: false, reason: "transport" };
      }
    },
  };
}
