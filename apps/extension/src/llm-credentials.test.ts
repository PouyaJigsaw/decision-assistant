import { describe, expect, it } from "vitest";
import type { ChatGptAuth } from "./chatgpt-oauth";
import { PLAN_SCOPE } from "./chatgpt-oauth";
import {
  SESSION_API_KEY,
  clearSessionApiKey,
  credentialForRequest,
  getConnection,
  setSessionApiKey,
  type DualKv,
} from "./llm-credentials";

function memoryDual(initial: { local?: Record<string, unknown>; session?: Record<string, unknown> } = {}): DualKv & {
  localData: Record<string, unknown>;
  sessionData: Record<string, unknown>;
} {
  const localData = { ...(initial.local ?? {}) };
  const sessionData = { ...(initial.session ?? {}) };
  return {
    localData,
    sessionData,
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

function auth(overrides: Partial<ChatGptAuth> = {}): ChatGptAuth {
  return {
    email: "user@example.com",
    issuer: "https://auth.openai.com",
    subject: "sub-1",
    client_id: "oaiapp_saved",
    ext_agent_host_id: "urn:uuid:host",
    id_token: "id",
    access_token: "chatgpt-access",
    refresh_token: "refresh",
    token_type: "Bearer",
    expires_at: Date.now() + 60_000,
    scopes: ["openid", PLAN_SCOPE],
    saved_at: new Date().toISOString(),
    ...overrides,
  };
}

describe("session API key", () => {
  it("writes the key only to session storage", async () => {
    const kv = memoryDual();
    await setSessionApiKey(kv, "sk-test-key");
    expect(kv.sessionData[SESSION_API_KEY]).toBe("sk-test-key");
    expect(kv.localData[SESSION_API_KEY]).toBeUndefined();
    expect(kv.localData.chatgptAuth).toBeUndefined();
    const connection = await getConnection(kv);
    expect(connection).toEqual({ kind: "api_key" });
    await clearSessionApiKey(kv);
    expect(kv.sessionData[SESSION_API_KEY]).toBeUndefined();
    expect(await getConnection(kv)).toEqual({ kind: "none" });
  });

  it("never returns the key for a request to the app origin", async () => {
    const kv = memoryDual({ session: { [SESSION_API_KEY]: "sk-secret" }, local: { chatgptAuth: auth() } });
    const openai = await credentialForRequest(kv, "https://api.openai.com/v1/responses");
    expect(openai).toEqual({ token: "sk-secret", stream: false, planUsage: false });
    const app = await credentialForRequest(kv, "http://127.0.0.1:8787/v1/evaluations");
    expect(app).toBeNull();
    const hosted = await credentialForRequest(kv, "https://decision-assistant.fly.dev/v1/roles");
    expect(hosted).toBeNull();
  });

  it("uses the ChatGPT access token when no session key is set", async () => {
    const kv = memoryDual({ local: { chatgptAuth: auth() } });
    expect(await getConnection(kv)).toEqual({
      kind: "chatgpt",
      email: "user@example.com",
      planUsage: true,
    });
    expect(await credentialForRequest(kv, "https://api.openai.com/v1/responses")).toEqual({
      token: "chatgpt-access",
      stream: true,
      planUsage: true,
    });
  });
});
