import { afterEach, describe, expect, it, vi } from "vitest";
import {
  AGENT_NAME,
  AUTH_AUTHORIZE,
  AUTH_TOKEN,
  CALLBACK_PAGE,
  CALLBACK_URI,
  DYNAMIC_CLIENT_ID,
  LOOPBACK_REDIRECT_RULE_ID,
  PLAN_SCOPE,
  RESOURCE,
  buildAuthorizeUrl,
  chatgptSignInErrorCopy,
  createChromeOAuthHost,
  disconnectChatGpt,
  installLoopbackRedirect,
  isOAuthCallbackUrl,
  loopbackRedirectRule,
  planUsageEnabled,
  refreshChatGpt,
  signInWithChatGpt,
  waitForLoopbackCallback,
  type ChatGptAuth,
  type Kv,
  type OAuthHost,
} from "./chatgpt-oauth";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function memoryKv(initial: Record<string, unknown> = {}): Kv {
  const data = { ...initial };
  return {
    async get(keys) {
      const found: Record<string, unknown> = {};
      for (const key of keys) found[key] = data[key];
      return found;
    },
    async set(values) {
      Object.assign(data, values);
    },
    async remove(keys) {
      for (const key of keys) delete data[key];
    },
    snapshot: data,
  } as Kv & { snapshot: Record<string, unknown> };
}

function b64url(bytes: Uint8Array | string): string {
  const data = typeof bytes === "string" ? new TextEncoder().encode(bytes) : bytes;
  let bin = "";
  for (const b of data) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function rsaPair() {
  return crypto.subtle.generateKey(
    { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
    true,
    ["sign", "verify"],
  );
}

async function signJwt(privateKey: CryptoKey, payload: Record<string, unknown>, kid = "k1") {
  const header = { alg: "RS256", typ: "JWT", kid };
  const data = `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(payload))}`;
  const sig = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", privateKey, new TextEncoder().encode(data));
  return `${data}.${b64url(new Uint8Array(sig))}`;
}

async function publicJwk(publicKey: CryptoKey, kid = "k1") {
  const jwk = await crypto.subtle.exportKey("jwk", publicKey);
  return { ...jwk, kid, use: "sig", alg: "RS256" };
}

function authRecord(overrides: Partial<ChatGptAuth> = {}): ChatGptAuth {
  return {
    email: "user@example.com",
    issuer: "https://auth.openai.com",
    subject: "sub-1",
    client_id: "oaiapp_saved",
    ext_agent_host_id: "urn:uuid:11111111-1111-4111-8111-111111111111",
    id_token: "id.token",
    access_token: "access-old",
    refresh_token: "refresh-old",
    token_type: "Bearer",
    expires_at: Date.now() + 3_600_000,
    scopes: ["openid", "profile", "email", "offline_access", "resource.invoke", PLAN_SCOPE],
    saved_at: new Date().toISOString(),
    ...overrides,
  };
}

describe("buildAuthorizeUrl", () => {
  it("registers a new client on loopback with PKCE and plan-usage scopes", () => {
    const url = buildAuthorizeUrl({
      clientId: DYNAMIC_CLIENT_ID,
      hostId: "urn:uuid:aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      state: "state-1",
      nonce: "nonce-1",
      codeChallenge: "challenge-1",
    });
    expect(url.origin + url.pathname).toBe(AUTH_AUTHORIZE);
    expect(url.searchParams.get("client_id")).toBe(DYNAMIC_CLIENT_ID);
    expect(url.searchParams.get("agent_name_hint")).toBe(AGENT_NAME);
    expect(url.searchParams.get("ext_agent_host_id")).toBe("urn:uuid:aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa");
    expect(url.searchParams.get("response_type")).toBe("code");
    expect(url.searchParams.get("redirect_uri")).toBe(CALLBACK_URI);
    expect(url.searchParams.get("resource")).toBe(RESOURCE);
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.searchParams.get("code_challenge")).toBe("challenge-1");
    expect(url.searchParams.get("state")).toBe("state-1");
    expect(url.searchParams.get("nonce")).toBe("nonce-1");
    expect(url.searchParams.get("scope")?.split(" ")).toEqual(
      expect.arrayContaining(["openid", "profile", "email", "offline_access", "resource.invoke", PLAN_SCOPE]),
    );
  });

  it("reuses an issued client id and omits the agent name on return", () => {
    const url = buildAuthorizeUrl({
      clientId: "oaiapp_saved",
      hostId: "urn:uuid:aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      state: "state-1",
      nonce: "nonce-1",
      codeChallenge: "challenge-1",
      idTokenHint: "id.token",
      loginHint: "user@example.com",
    });
    expect(url.searchParams.get("client_id")).toBe("oaiapp_saved");
    expect(url.searchParams.get("agent_name_hint")).toBeNull();
    expect(url.searchParams.get("id_token_hint")).toBe("id.token");
    expect(url.searchParams.get("login_hint")).toBe("user@example.com");
  });
});

async function discoveryAndJwks(jwk: JsonWebKey) {
  return {
    issuer: "https://auth.openai.com",
    jwks_uri: "https://auth.openai.com/.well-known/jwks.json",
    token_endpoint: AUTH_TOKEN,
    revocation_endpoint: "https://auth.openai.com/api/accounts/oauth/revoke",
    keys: [jwk],
  };
}

function captureHost(
  fetchImpl: typeof fetch,
  callback: (authorizeUrl: string) => Promise<string>,
): OAuthHost & { authorizeUrl: string } {
  const host: OAuthHost & { authorizeUrl: string } = {
    authorizeUrl: "",
    crypto,
    now: () => 1_700_000_000_000,
    fetch: fetchImpl,
    randomBytes(size) {
      return crypto.getRandomValues(new Uint8Array(size));
    },
    async openTab(url) {
      host.authorizeUrl = url;
      return 42;
    },
    async closeTab() {
      return;
    },
    async waitForCallback() {
      return callback(host.authorizeUrl);
    },
  };
  return host;
}

describe("signInWithChatGpt", () => {
  it("exchanges the loopback code, verifies the id token, and stores rotating credentials", async () => {
    const pair = await rsaPair();
    const jwk = await publicJwk(pair.publicKey);
    const kv = memoryKv();
    const recorded: { url: string; body?: string }[] = [];
    let host: ReturnType<typeof captureHost>;
    const fetchImpl: typeof fetch = async (input, init) => {
      const url = String(input);
      recorded.push({ url, body: typeof init?.body === "string" ? init.body : undefined });
      if (url.endsWith("/.well-known/openid-configuration")) {
        return new Response(JSON.stringify(await discoveryAndJwks(jwk)));
      }
      if (url.endsWith("/jwks.json")) {
        return new Response(JSON.stringify({ keys: [jwk] }));
      }
      if (url === AUTH_TOKEN) {
        const nonce = new URL(host.authorizeUrl).searchParams.get("nonce") ?? "";
        const idToken = await signJwt(pair.privateKey, {
          iss: "https://auth.openai.com",
          aud: "oaiapp_issued",
          sub: "sub-1",
          email: "user@example.com",
          nonce,
          exp: Math.floor(Date.now() / 1000) + 3600,
        });
        return new Response(
          JSON.stringify({
            access_token: "access-1",
            refresh_token: "refresh-1",
            id_token: idToken,
            token_type: "Bearer",
            expires_in: 3600,
            scope: `openid profile email offline_access resource.invoke ${PLAN_SCOPE}`,
          }),
        );
      }
      throw new Error(url);
    };
    host = captureHost(fetchImpl, async (authorizeUrl) => {
      const state = new URL(authorizeUrl).searchParams.get("state");
      return `http://127.0.0.1:1455/auth/callback?code=auth-code&state=${state}&client_id=oaiapp_issued`;
    });

    const session = await signInWithChatGpt(host, kv);
    expect(session.planUsage).toBe(true);
    expect(session.email).toBe("user@example.com");
    const tokenCall = recorded.find((item) => item.url === AUTH_TOKEN);
    expect(tokenCall?.body).toContain("grant_type=authorization_code");
    expect(tokenCall?.body).toContain("client_id=oaiapp_issued");
    expect(tokenCall?.body).toContain("code=auth-code");
    expect(tokenCall?.body).toContain(`redirect_uri=${encodeURIComponent(CALLBACK_URI)}`);
    expect(tokenCall?.body).not.toContain("client_secret");
    const stored = (await kv.get(["chatgptAuth", "chatgptHostId"])) as {
      chatgptAuth?: ChatGptAuth;
      chatgptHostId?: string;
    };
    expect(stored.chatgptAuth?.access_token).toBe("access-1");
    expect(stored.chatgptAuth?.refresh_token).toBe("refresh-1");
    expect(stored.chatgptAuth?.client_id).toBe("oaiapp_issued");
    expect(stored.chatgptHostId).toMatch(/^urn:uuid:/);
    expect(planUsageEnabled(stored.chatgptAuth!)).toBe(true);
  });

  it("keeps identity sign-in when plan usage was declined", async () => {
    const pair = await rsaPair();
    const jwk = await publicJwk(pair.publicKey);
    const kv = memoryKv();
    let host: ReturnType<typeof captureHost>;
    const fetchImpl: typeof fetch = async (input) => {
      const url = String(input);
      if (url.endsWith("/.well-known/openid-configuration")) {
        return new Response(JSON.stringify(await discoveryAndJwks(jwk)));
      }
      if (url.endsWith("/jwks.json")) return new Response(JSON.stringify({ keys: [jwk] }));
      if (url === AUTH_TOKEN) {
        const nonce = new URL(host.authorizeUrl).searchParams.get("nonce") ?? "";
        const idToken = await signJwt(pair.privateKey, {
          iss: "https://auth.openai.com",
          aud: "oaiapp_issued",
          sub: "sub-1",
          email: "user@example.com",
          nonce,
          exp: Math.floor(Date.now() / 1000) + 3600,
        });
        return new Response(
          JSON.stringify({
            access_token: "access-1",
            refresh_token: "refresh-1",
            id_token: idToken,
            token_type: "Bearer",
            expires_in: 3600,
            scope: "openid profile email",
          }),
        );
      }
      throw new Error(url);
    };
    host = captureHost(fetchImpl, async (authorizeUrl) => {
      const state = new URL(authorizeUrl).searchParams.get("state");
      return `http://127.0.0.1:1455/auth/callback?code=auth-code&state=${state}&client_id=oaiapp_issued`;
    });
    const session = await signInWithChatGpt(host, kv);
    expect(session.planUsage).toBe(false);
    expect(session.email).toBe("user@example.com");
  });

  it("exchanges a code captured on the extension callback page", async () => {
    const pair = await rsaPair();
    const jwk = await publicJwk(pair.publicKey);
    const kv = memoryKv();
    let host: ReturnType<typeof captureHost>;
    const fetchImpl: typeof fetch = async (input) => {
      const url = String(input);
      if (url.endsWith("/.well-known/openid-configuration")) {
        return new Response(JSON.stringify(await discoveryAndJwks(jwk)));
      }
      if (url.endsWith("/jwks.json")) return new Response(JSON.stringify({ keys: [jwk] }));
      if (url === AUTH_TOKEN) {
        const nonce = new URL(host.authorizeUrl).searchParams.get("nonce") ?? "";
        const idToken = await signJwt(pair.privateKey, {
          iss: "https://auth.openai.com",
          aud: "oaiapp_issued",
          sub: "sub-1",
          email: "user@example.com",
          nonce,
          exp: Math.floor(Date.now() / 1000) + 3600,
        });
        return new Response(
          JSON.stringify({
            access_token: "access-1",
            refresh_token: "refresh-1",
            id_token: idToken,
            token_type: "Bearer",
            expires_in: 3600,
            scope: `openid ${PLAN_SCOPE}`,
          }),
        );
      }
      throw new Error(url);
    };
    host = captureHost(fetchImpl, async (authorizeUrl) => {
      const state = new URL(authorizeUrl).searchParams.get("state");
      return `chrome-extension://abcdefghijklmnopqrstuvwxyzabcdef/${CALLBACK_PAGE}?code=auth-code&state=${state}&client_id=oaiapp_issued`;
    });
    const session = await signInWithChatGpt(host, kv);
    expect(session.planUsage).toBe(true);
    expect(session.email).toBe("user@example.com");
  });
});

describe("refreshChatGpt", () => {
  it("stores the replacement refresh token and serializes concurrent refreshes", async () => {
    const kv = memoryKv({ chatgptAuth: authRecord() });
    let inFlight = 0;
    let max = 0;
    let n = 0;
    const host: OAuthHost = {
      crypto,
      now: () => 1_700_000_000_000,
      fetch: async (input, init) => {
        const url = String(input);
        if (url === AUTH_TOKEN) {
          inFlight += 1;
          max = Math.max(max, inFlight);
          await new Promise((resolve) => setTimeout(resolve, 20));
          n += 1;
          inFlight -= 1;
          expect(String(init?.body)).toContain("grant_type=refresh_token");
          expect(String(init?.body)).toContain("refresh_token=refresh-old");
          expect(String(init?.body)).toContain("client_id=oaiapp_saved");
          return new Response(
            JSON.stringify({
              access_token: `access-${n}`,
              refresh_token: `refresh-${n}`,
              token_type: "Bearer",
              expires_in: 3600,
              scope: `openid ${PLAN_SCOPE}`,
            }),
          );
        }
        throw new Error(url);
      },
      randomBytes: () => new Uint8Array(16),
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
    const [a, b] = await Promise.all([refreshChatGpt(host, kv), refreshChatGpt(host, kv)]);
    expect(max).toBe(1);
    expect(a.refresh_token).toBe(b.refresh_token);
    const stored = (await kv.get(["chatgptAuth"])).chatgptAuth as ChatGptAuth;
    expect(stored.refresh_token).toMatch(/^refresh-/);
    expect(stored.access_token).toMatch(/^access-/);
  });

  it("clears tokens on an unusable refresh grant", async () => {
    const kv = memoryKv({ chatgptAuth: authRecord(), chatgptHostId: "urn:uuid:host" });
    const host: OAuthHost = {
      crypto,
      now: () => Date.now(),
      fetch: async () =>
        new Response(JSON.stringify({ error: "invalid_grant" }), { status: 400 }),
      randomBytes: () => new Uint8Array(16),
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
    await expect(refreshChatGpt(host, kv)).rejects.toThrow(/invalid_grant|expired/);
    const stored = await kv.get(["chatgptAuth", "chatgptHostId"]);
    expect(stored.chatgptAuth).toMatchObject({
      client_id: "oaiapp_saved",
      access_token: "",
      refresh_token: "",
    });
    expect(stored.chatgptHostId).toBe("urn:uuid:host");
  });
});

describe("disconnectChatGpt", () => {
  it("revokes the refresh token and keeps the issued client id", async () => {
    const kv = memoryKv({
      chatgptAuth: authRecord(),
      chatgptHostId: "urn:uuid:host",
    });
    const recorded: string[] = [];
    const host: OAuthHost = {
      crypto,
      now: () => Date.now(),
      fetch: async (input, init) => {
        recorded.push(`${String(input)} ${String(init?.body)}`);
        if (String(input).endsWith("/.well-known/openid-configuration")) {
          return new Response(
            JSON.stringify({
              revocation_endpoint: "https://auth.openai.com/api/accounts/oauth/revoke",
            }),
          );
        }
        return new Response(null, { status: 200 });
      },
      randomBytes: () => new Uint8Array(16),
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
    await disconnectChatGpt(host, kv);
    expect(recorded.some((row) => row.includes("token=refresh-old") && row.includes("token_type_hint=refresh_token"))).toBe(
      true,
    );
    const stored = await kv.get(["chatgptAuth", "chatgptHostId"]);
    expect(stored.chatgptHostId).toBe("urn:uuid:host");
    expect(stored.chatgptAuth).toMatchObject({
      client_id: "oaiapp_saved",
      access_token: "",
      refresh_token: "",
      id_token: "",
    });
  });
});

describe("oauth callback capture", () => {
  it("recognizes loopback and extension callback URLs that carry a result", () => {
    const ext = `chrome-extension://abcdefghijklmnopqrstuvwxyzabcdef/${CALLBACK_PAGE}`;
    expect(isOAuthCallbackUrl(`http://127.0.0.1:1455/auth/callback?code=a&state=s&client_id=oaiapp`, ext)).toBe(true);
    expect(isOAuthCallbackUrl(`${ext}?code=a&state=s&client_id=oaiapp`, ext)).toBe(true);
    expect(isOAuthCallbackUrl("https://auth.openai.com/api/accounts/authorize", ext)).toBe(false);
    expect(isOAuthCallbackUrl(ext, ext)).toBe(false);
  });

  it("redirects the loopback callback onto the extension page and keeps the query", () => {
    const ext = `chrome-extension://abcdefghijklmnopqrstuvwxyzabcdef/${CALLBACK_PAGE}`;
    const rule = loopbackRedirectRule(ext, 9);
    expect(rule.id).toBe(LOOPBACK_REDIRECT_RULE_ID);
    expect(rule.action).toEqual({
      type: "redirect",
      redirect: { regexSubstitution: `${ext}\\1` },
    });
    expect(rule.condition.regexFilter).toBe("^http://127\\.0\\.0\\.1:1455/auth/callback(\\?.*)?$");
    expect(rule.condition.resourceTypes).toEqual(["main_frame"]);
    expect(rule.condition.tabIds).toEqual([9]);
  });

  it("installs the session redirect before waiting and resolves from onBeforeNavigate", async () => {
    const ext = `chrome-extension://ext/${CALLBACK_PAGE}`;
    const nav = listen();
    const dnr = { updateSessionRules: vi.fn(async () => undefined) };
    vi.stubGlobal("chrome", {
      runtime: { getURL: (path: string) => `chrome-extension://ext/${path}` },
      declarativeNetRequest: dnr,
      webNavigation: {
        onBeforeNavigate: nav.onBeforeNavigate,
        onErrorOccurred: nav.onErrorOccurred,
        onCommitted: nav.onCommitted,
        onCompleted: nav.onCompleted,
      },
      tabs: { onUpdated: nav.onUpdated },
    });
    await installLoopbackRedirect(4);
    expect(dnr.updateSessionRules).toHaveBeenCalledWith({
      removeRuleIds: [LOOPBACK_REDIRECT_RULE_ID],
      addRules: [loopbackRedirectRule(ext, 4)],
    });
    const pending = waitForLoopbackCallback(4, 1_000);
    nav.onBeforeNavigate.emit({
      tabId: 4,
      url: "http://127.0.0.1:1455/auth/callback?code=from-nav&state=s&client_id=oaiapp",
    });
    await expect(pending).resolves.toContain("code=from-nav");
  });

  it("resolves after Chrome rewrites the tab to the extension callback page", async () => {
    const nav = listen();
    vi.stubGlobal("chrome", {
      runtime: { getURL: (path: string) => `chrome-extension://ext/${path}` },
      webNavigation: {
        onBeforeNavigate: nav.onBeforeNavigate,
        onErrorOccurred: nav.onErrorOccurred,
        onCommitted: nav.onCommitted,
        onCompleted: nav.onCompleted,
      },
      tabs: { onUpdated: nav.onUpdated },
    });
    const pending = waitForLoopbackCallback(4, 1_000);
    nav.onUpdated.emit(
      4,
      { url: `chrome-extension://ext/${CALLBACK_PAGE}?code=from-dnr&state=s&client_id=oaiapp` },
      { id: 4, url: `chrome-extension://ext/${CALLBACK_PAGE}?code=from-dnr&state=s&client_id=oaiapp` },
    );
    await expect(pending).resolves.toContain("code=from-dnr");
  });
});

describe("createChromeOAuthHost", () => {
  it("calls fetch as a window function so Chrome does not throw Illegal invocation", async () => {
    vi.stubGlobal("fetch", function fetch(this: unknown) {
      if (this != null && this !== globalThis) {
        throw new TypeError("Failed to execute 'fetch' on 'Window': Illegal invocation");
      }
      return Promise.resolve(new Response("{}"));
    });
    const host = createChromeOAuthHost();
    await expect(host.fetch("https://auth.openai.com/.well-known/openid-configuration")).resolves.toBeInstanceOf(
      Response,
    );
  });
});

describe("chatgptSignInErrorCopy", () => {
  it("keeps access_denied distinct and includes other oauth codes", () => {
    expect(chatgptSignInErrorCopy("access_denied")).toBe("ChatGPT plan usage was not enabled.");
    expect(chatgptSignInErrorCopy("oauth_timeout")).toMatch(/timed out/i);
    expect(chatgptSignInErrorCopy("oauth_client")).toMatch(/client/i);
    expect(chatgptSignInErrorCopy("invalid_id_token")).toBe("ChatGPT sign-in failed (invalid_id_token).");
  });
});

function listen() {
  function hub<Args extends unknown[]>() {
    const listeners: Array<(...args: Args) => void> = [];
    return {
      addListener(fn: (...args: Args) => void) {
        listeners.push(fn);
      },
      removeListener(fn: (...args: Args) => void) {
        const index = listeners.indexOf(fn);
        if (index >= 0) listeners.splice(index, 1);
      },
      emit(...args: Args) {
        for (const listener of [...listeners]) listener(...args);
      },
    };
  }
  return {
    onBeforeNavigate: hub<[details: { tabId: number; url?: string }]>(),
    onErrorOccurred: hub<[details: { tabId: number; url?: string }]>(),
    onCommitted: hub<[details: { tabId: number; url?: string }]>(),
    onCompleted: hub<[details: { tabId: number; url?: string }]>(),
    onUpdated: hub<
      [id: number, change: { url?: string }, tab: { id?: number; url?: string }]
    >(),
  };
}
