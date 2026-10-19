import { describe, expect, it } from "vitest";
import { COMPARE_JSON_SCHEMA } from "@decision-assistant/domain";
import {
  MODELS_URL,
  OpenAiError,
  RESPONSES_URL,
  completeResponse,
  listModels,
} from "./openai-responses";

function sse(events: unknown[]): string {
  return events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join("") + "data: [DONE]\n\n";
}

describe("listModels", () => {
  it("shows list-visible slugs for a ChatGPT token", async () => {
    const fetchImpl: typeof fetch = async (url, init) => {
      expect(String(url)).toBe(MODELS_URL);
      expect(new Headers(init?.headers).get("Authorization")).toBe("Bearer chatgpt-access");
      return new Response(
        JSON.stringify({
          models: [
            { slug: "gpt-5.4", display_name: "GPT-5.4", visibility: "list" },
            { slug: "hidden", display_name: "Hidden", visibility: "none" },
          ],
        }),
      );
    };
    await expect(listModels({ token: "chatgpt-access", planUsage: true, fetchImpl })).resolves.toEqual([
      { slug: "gpt-5.4", display_name: "GPT-5.4" },
    ]);
  });
});

describe("completeResponse", () => {
  it("requires response.completed on a ChatGPT stream", async () => {
    const fetchImpl: typeof fetch = async (url, init) => {
      expect(String(url)).toBe(RESPONSES_URL);
      const body = JSON.parse(String(init?.body)) as { store: boolean; stream: boolean; instructions: string };
      expect(body.store).toBe(false);
      expect(body.stream).toBe(true);
      expect(body.instructions).toBe("Return JSON");
      expect("temperature" in body).toBe(false);
      return new Response(
        sse([
          { type: "response.output_text.delta", delta: '{"ok":true}' },
          {
            type: "response.completed",
            response: { model: "gpt-5.4", usage: { input_tokens: 11, output_tokens: 4 } },
          },
        ]),
        { headers: { "content-type": "text/event-stream" } },
      );
    };
    await expect(
      completeResponse({
        token: "chatgpt-access",
        model: "gpt-5.4",
        instructions: "Return JSON",
        input: "notes",
        stream: true,
        fetchImpl,
      }),
    ).resolves.toEqual({ model: "gpt-5.4", text: '{"ok":true}', inputTokens: 11, outputTokens: 4 });
  });

  it("fails a stream that ends without response.completed", async () => {
    const fetchImpl: typeof fetch = async () =>
      new Response(sse([{ type: "response.output_text.delta", delta: "partial" }]), {
        headers: { "content-type": "text/event-stream" },
      });
    await expect(
      completeResponse({
        token: "chatgpt-access",
        model: "gpt-5.4",
        instructions: "Return JSON",
        input: "notes",
        stream: true,
        fetchImpl,
      }),
    ).rejects.toThrow(/completed/);
  });

  it("uses a non-stream JSON response for an API key", async () => {
    const fetchImpl: typeof fetch = async (url, init) => {
      const body = JSON.parse(String(init?.body)) as { stream: boolean; store: boolean };
      expect(body.stream).toBe(false);
      expect(body.store).toBe(false);
      expect(new Headers(init?.headers).get("Authorization")).toBe("Bearer sk-test");
      return new Response(
        JSON.stringify({
          model: "gpt-5.4",
          output_text: '{"criteria":[]}',
          usage: { input_tokens: 3, output_tokens: 2 },
        }),
      );
    };
    await expect(
      completeResponse({
        token: "sk-test",
        model: "gpt-5.4",
        instructions: "Return JSON",
        input: "notes",
        stream: false,
        fetchImpl,
      }),
    ).resolves.toEqual({ model: "gpt-5.4", text: '{"criteria":[]}', inputTokens: 3, outputTokens: 2 });
  });

  it("retries once without json_schema when plan usage rejects that field", async () => {
    const bodies: unknown[] = [];
    const fetchImpl: typeof fetch = async (_url, init) => {
      const body = JSON.parse(String(init?.body)) as { text?: unknown };
      bodies.push(body.text);
      if (bodies.length === 1) {
        return new Response(
          JSON.stringify({
            error: { code: "subscription_sharing_unsupported_capability", param: "text.format" },
          }),
          { status: 400 },
        );
      }
      return new Response(
        sse([
          { type: "response.output_text.delta", delta: '{"answers":[]}' },
          {
            type: "response.completed",
            response: { model: "gpt-5.4", usage: { input_tokens: 1, output_tokens: 1 } },
          },
        ]),
        { headers: { "content-type": "text/event-stream" } },
      );
    };
    const result = await completeResponse({
      token: "chatgpt-access",
      model: "gpt-5.4",
      instructions: "Return JSON",
      input: "notes",
      stream: true,
      jsonSchema: COMPARE_JSON_SCHEMA,
      fetchImpl,
    });
    expect(bodies[0]).toEqual({
      format: { type: "json_schema", name: "result", schema: COMPARE_JSON_SCHEMA, strict: true },
    });
    expect(bodies[1]).toBeUndefined();
    expect(result.text).toBe('{"answers":[]}');
  });

  it("surfaces a usage-limit error without retrying another credential", async () => {
    const fetchImpl: typeof fetch = async () =>
      new Response(
        JSON.stringify({ error: { code: "subscription_sharing_usage_limit_exceeded" } }),
        { status: 429 },
      );
    await expect(
      completeResponse({
        token: "chatgpt-access",
        model: "gpt-5.4",
        instructions: "Return JSON",
        input: "notes",
        stream: true,
        fetchImpl,
      }),
    ).rejects.toMatchObject({
      name: "OpenAiError",
      code: "subscription_sharing_usage_limit_exceeded",
      manageUsage: true,
    } satisfies Partial<OpenAiError>);
  });
});
