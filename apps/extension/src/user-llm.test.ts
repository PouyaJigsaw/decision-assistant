import { compareLlmRequest, draftLlmRequest, sampleRubric } from "@decision-assistant/domain";
import { describe, expect, it } from "vitest";
import { PLAN_SCOPE, type ChatGptAuth, type OAuthHost } from "./chatgpt-oauth";
import { SESSION_API_KEY, type DualKv } from "./llm-credentials";
import { completeCompare, completeDraft } from "./user-llm";

function dual(initial: { local?: Record<string, unknown>; session?: Record<string, unknown> } = {}): DualKv {
  const localData = { ...(initial.local ?? {}) };
  const sessionData = { ...(initial.session ?? {}) };
  return {
    local: {
      async get(keys) {
        const found: Record<string, unknown> = {};
        for (const key of keys) found[key] = localData[key];
        return found;
      },
      async set(values) {
        Object.assign(localData, values);
      },
      async remove(keys) {
        for (const key of keys) delete localData[key];
      },
    },
    session: {
      async get(keys) {
        const found: Record<string, unknown> = {};
        for (const key of keys) found[key] = sessionData[key];
        return found;
      },
      async set(values) {
        Object.assign(sessionData, values);
      },
      async remove(keys) {
        for (const key of keys) delete sessionData[key];
      },
    },
  };
}

function host(fetchImpl: typeof fetch): OAuthHost {
  return {
    crypto,
    now: () => Date.now(),
    fetch: fetchImpl,
    randomBytes: (size) => crypto.getRandomValues(new Uint8Array(size)),
    async openTab() {
      return 1;
    },
    async closeTab() {
      return;
    },
    async waitForCallback() {
      return "";
    },
  };
}

describe("completeDraft", () => {
  it("sends the shared prompt to OpenAI and never to the app origin", async () => {
    const urls: string[] = [];
    const fetchImpl: typeof fetch = async (input, init) => {
      const url = String(input);
      urls.push(url);
      expect(url.startsWith("http://127.0.0.1")).toBe(false);
      expect(url.includes("decision-assistant")).toBe(false);
      const body = JSON.parse(String(init?.body)) as { instructions: string; input: { content: string }[] };
      const expected = draftLlmRequest("Need five years of Go.");
      expect(body.instructions).toBe(expected.instructions);
      expect(body.input[0]?.content).toBe(expected.input);
      return new Response(
        JSON.stringify({
          model: "gpt-5.4",
          output_text: '{"criteria":[]}',
          usage: { input_tokens: 2, output_tokens: 1 },
        }),
      );
    };
    const result = await completeDraft(
      dual({ session: { [SESSION_API_KEY]: "sk-test" } }),
      host(fetchImpl),
      "Need five years of Go.",
    );
    expect(result).toEqual({ model: "gpt-5.4", text: '{"criteria":[]}', inputTokens: 2, outputTokens: 1 });
    expect(urls).toEqual(["https://api.openai.com/v1/responses"]);
  });

  it("refuses to complete when no credential is connected", async () => {
    await expect(completeDraft(dual(), host(fetch), "notes")).rejects.toThrow("llm_not_connected");
  });

  it("drafts with a listed ChatGPT model and the documented Responses body", async () => {
    const auth: ChatGptAuth = {
      email: "user@example.com",
      issuer: "https://auth.openai.com",
      subject: "sub",
      client_id: "oaiapp",
      ext_agent_host_id: "urn:uuid:host",
      id_token: "id",
      access_token: "chatgpt-access",
      refresh_token: "refresh",
      token_type: "Bearer",
      expires_at: Date.now() + 10 * 60_000,
      scopes: [PLAN_SCOPE],
      saved_at: new Date().toISOString(),
    };
    const bodies: Record<string, unknown>[] = [];
    const fetchImpl: typeof fetch = async (input, init) => {
      const url = String(input);
      if (url.includes("/models")) {
        return new Response(
          JSON.stringify({
            models: [
              { slug: "gpt-6.1-sol", display_name: "GPT-6.1", visibility: "list" },
              { slug: "gpt-5.4", display_name: "GPT-5.4", visibility: "none" },
            ],
          }),
        );
      }
      bodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
      return new Response(
        [
          `data: ${JSON.stringify({ type: "response.output_text.delta", delta: '{"criteria":[]}' })}\n\n`,
          `data: ${JSON.stringify({ type: "response.completed", response: { model: "gpt-6.1-sol", usage: { input_tokens: 2, output_tokens: 1 } } })}\n\n`,
        ].join(""),
        { headers: { "content-type": "text/event-stream" } },
      );
    };
    const expected = draftLlmRequest("Need five years of Go.");
    const result = await completeDraft(dual({ local: { chatgptAuth: auth } }), host(fetchImpl), "Need five years of Go.");
    expect(result.model).toBe("gpt-6.1-sol");
    expect(bodies).toHaveLength(1);
    expect(bodies[0]?.model).toBe("gpt-6.1-sol");
    expect(bodies[0]).not.toHaveProperty("instructions");
    expect(bodies[0]?.store).toBe(false);
    expect(bodies[0]?.stream).toBe(true);
    expect(bodies[0]?.input).toEqual([{ role: "user", content: `${expected.instructions}\n\n${expected.input}` }]);
  });
});

describe("completeCompare", () => {
  it("posts the shared compare prompt with a ChatGPT access token", async () => {
    const auth: ChatGptAuth = {
      email: "user@example.com",
      issuer: "https://auth.openai.com",
      subject: "sub",
      client_id: "oaiapp",
      ext_agent_host_id: "urn:uuid:host",
      id_token: "id",
      access_token: "chatgpt-access",
      refresh_token: "refresh",
      token_type: "Bearer",
      expires_at: Date.now() + 10 * 60_000,
      scopes: [PLAN_SCOPE],
      saved_at: new Date().toISOString(),
    };
    const fetchImpl: typeof fetch = async (input, init) => {
      const url = String(input);
      expect(new Headers(init?.headers).get("Authorization")).toBe("Bearer chatgpt-access");
      if (url.includes("/models")) {
        return new Response(
          JSON.stringify({
            models: [{ slug: "gpt-5.4", display_name: "GPT-5.4", visibility: "list" }],
          }),
        );
      }
      expect(url).toBe("https://api.openai.com/v1/responses");
      const expected = compareLlmRequest(sampleRubric, "profile");
      const body = JSON.parse(String(init?.body)) as {
        stream: boolean;
        instructions?: string;
        input: { content: string }[];
      };
      expect(body.stream).toBe(true);
      expect(body.instructions).toBeUndefined();
      expect(body.input[0]?.content).toBe(`${expected.instructions}\n\n${expected.input}`);
      return new Response(
        [
          `data: ${JSON.stringify({ type: "response.output_text.delta", delta: '{"answers":[]}' })}\n\n`,
          `data: ${JSON.stringify({ type: "response.completed", response: { model: "gpt-5.4", usage: { input_tokens: 1, output_tokens: 1 } } })}\n\n`,
        ].join(""),
        { headers: { "content-type": "text/event-stream" } },
      );
    };
    const result = await completeCompare(dual({ local: { chatgptAuth: auth } }), host(fetchImpl), sampleRubric, "profile");
    expect(result.text).toBe('{"answers":[]}');
  });
});
