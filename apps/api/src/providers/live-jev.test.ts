import { JEV_REQUEST_MODEL, sampleRubric, toJevRequest } from "@decision-assistant/domain";
import { describe, expect, it } from "vitest";
import { createLiveJev } from "./live-jev";

const profile = "Staff engineer. Led the payments API in Go for four years.";
const JEV_URL = "https://api.defapi.org/api/v1/decisions";

function evaluateInput() {
  const { model: _model, ...input } = toJevRequest(sampleRubric, profile);
  return input;
}

describe("createLiveJev", () => {
  it("posts once to DefAPI decisions with bearer auth and the toJevRequest body", async () => {
    const recorded: { url: unknown; init?: RequestInit }[] = [];
    const payload = { model: "jev-1.13.0", answers: { go: { type: "choice" } }, extra: "untouched" };
    const fetchImpl: typeof fetch = async (url, init) => {
      recorded.push({ url, init });
      return new Response(JSON.stringify(payload), { status: 200 });
    };

    const jev = createLiveJev({ apiKey: "test-key", fetchImpl });
    const result = await jev.evaluate(evaluateInput());

    expect(recorded).toHaveLength(1);
    expect(recorded[0]?.url).toBe(JEV_URL);
    const init = recorded[0]?.init;
    expect(init?.method).toBe("POST");
    expect(init?.signal).toBeInstanceOf(AbortSignal);
    const headers = new Headers(init?.headers);
    expect(headers.get("Authorization")).toBe("Bearer test-key");
    expect(headers.get("Accept")).toBe("application/json");
    expect(headers.get("Content-Type")).toBe("application/json");
    const body = JSON.parse(String(init?.body)) as {
      model: string;
      state: string;
      questions: Record<string, unknown>;
    };
    expect(body.model).toBe(JEV_REQUEST_MODEL);
    expect(body.state).toBe(profile);
    expect(Object.keys(body.questions)).toEqual(sampleRubric.map((c) => c.id));
    expect(result).toEqual({ ok: true, model: "jev-1.13.0", payload });
  });

  it("rewrites a DefAPI model id to a versioned jev model", async () => {
    const fetchImpl: typeof fetch = async () =>
      new Response(JSON.stringify({ model: "typesafe/jev-1.13-20260917", answers: {} }), { status: 200 });
    const jev = createLiveJev({ apiKey: "test-key", model: "typesafe/jev-1.13", fetchImpl });
    const result = await jev.evaluate(evaluateInput());
    expect(result).toMatchObject({ ok: true, model: "jev-1.13.20260917" });
    if (result.ok) {
      expect((result.payload as { model: string }).model).toBe("jev-1.13.20260917");
    }
  });

  it("returns the 200 JSON body as payload without parsing answers", async () => {
    const payload = { not: "a jev schema", answers: 12 };
    const fetchImpl: typeof fetch = async () => new Response(JSON.stringify(payload), { status: 200 });
    const jev = createLiveJev({ apiKey: "test-key", fetchImpl });
    await expect(jev.evaluate(evaluateInput())).resolves.toEqual({ ok: true, model: "", payload });
  });

  it("returns timeout when fetch rejects with TimeoutError", async () => {
    const fetchImpl: typeof fetch = async () => {
      throw Object.assign(new Error("t"), { name: "TimeoutError" });
    };
    const jev = createLiveJev({ apiKey: "test-key", fetchImpl });
    await expect(jev.evaluate(evaluateInput())).resolves.toEqual({ ok: false, reason: "timeout" });
  });

  it("returns timeout when fetch rejects with AbortError", async () => {
    const fetchImpl: typeof fetch = async () => {
      throw Object.assign(new Error("aborted"), { name: "AbortError" });
    };
    const jev = createLiveJev({ apiKey: "test-key", fetchImpl });
    await expect(jev.evaluate(evaluateInput())).resolves.toEqual({ ok: false, reason: "timeout" });
  });

  it("returns transport on HTTP 422", async () => {
    const fetchImpl: typeof fetch = async () => new Response("unprocessable", { status: 422 });
    const jev = createLiveJev({ apiKey: "test-key", fetchImpl });
    await expect(jev.evaluate(evaluateInput())).resolves.toEqual({ ok: false, reason: "transport" });
  });

  it("returns transport when a 200 body is not JSON", async () => {
    const fetchImpl: typeof fetch = async () => new Response("not-json", { status: 200 });
    const jev = createLiveJev({ apiKey: "test-key", fetchImpl });
    await expect(jev.evaluate(evaluateInput())).resolves.toEqual({ ok: false, reason: "transport" });
  });

  it("returns transport on any other fetch throw", async () => {
    const fetchImpl: typeof fetch = async () => {
      throw new Error("ECONNRESET");
    };
    const jev = createLiveJev({ apiKey: "test-key", fetchImpl });
    await expect(jev.evaluate(evaluateInput())).resolves.toEqual({ ok: false, reason: "transport" });
  });
});
