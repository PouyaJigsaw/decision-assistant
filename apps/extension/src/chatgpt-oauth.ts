export const AUTH_AUTHORIZE = "https://auth.openai.com/api/accounts/authorize";
export const AUTH_TOKEN = "https://auth.openai.com/api/accounts/oauth/token";
export const AUTH_DISCOVERY = "https://auth.openai.com/.well-known/openid-configuration";
export const RESOURCE = "https://api.openai.com/v1";
export const PLAN_SCOPE = "chatgpt.tokens.use.direct";
export const SCOPES = `openid profile email offline_access resource.invoke ${PLAN_SCOPE}`;
export const AGENT_NAME = "Who Fits?";
export const CALLBACK_URI = "http://127.0.0.1:1455/auth/callback";
export const CALLBACK_PAGE = "oauth-callback.html";
export const LOOPBACK_REDIRECT_RULE_ID = 1455;
export const DYNAMIC_CLIENT_ID = "dynamic_agent_client";
export const CHATGPT_USAGE_URL = "https://chatgpt.com/#settings";

export type Kv = {
  get(keys: string[]): Promise<Record<string, unknown>>;
  set(values: Record<string, unknown>): Promise<void>;
  remove(keys: string[]): Promise<void>;
};

export type OAuthHost = {
  crypto: Crypto;
  now: () => number;
  fetch: typeof fetch;
  randomBytes: (size: number) => Uint8Array;
  openTab: (url: string) => Promise<number>;
  closeTab: (id: number) => Promise<void>;
  waitForCallback: (tabId: number) => Promise<string>;
};

export type ChatGptAuth = {
  email: string;
  issuer: string;
  subject: string;
  client_id: string;
  ext_agent_host_id: string;
  id_token: string;
  access_token: string;
  refresh_token: string;
  token_type: string;
  expires_at: number;
  scopes: string[];
  saved_at: string;
};

export type ChatGptSession = {
  email: string;
  planUsage: boolean;
  auth: ChatGptAuth;
};

type Discovery = {
  issuer?: string;
  jwks_uri?: string;
  token_endpoint?: string;
  revocation_endpoint?: string;
};

let discoveryCache: Discovery | null = null;
let refreshLock: Promise<ChatGptAuth> | null = null;

function base64Url(bytes: Uint8Array | string): string {
  const data = typeof bytes === "string" ? new TextEncoder().encode(bytes) : bytes;
  let bin = "";
  for (const b of data) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromB64url(value: string): Uint8Array {
  const pad = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = pad + "=".repeat((4 - (pad.length % 4)) % 4);
  const bin = atob(padded);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) out[i] = bin.charCodeAt(i);
  return out;
}

function decodeJson(value: string): Record<string, unknown> {
  return JSON.parse(new TextDecoder().decode(fromB64url(value))) as Record<string, unknown>;
}

export function planUsageEnabled(auth: ChatGptAuth): boolean {
  return auth.scopes.includes(PLAN_SCOPE) && Boolean(auth.access_token);
}

export function chatgptSignInErrorCopy(error: string): string {
  if (error === "access_denied") return "ChatGPT plan usage was not enabled.";
  if (error === "oauth_timeout") return "ChatGPT sign-in timed out. Complete it in the opened tab.";
  if (error === "oauth_client") return "ChatGPT did not issue a client for this app.";
  if (error === "oauth_state") return "ChatGPT sign-in could not be verified. Try again.";
  if (error === "oauth_redirect") return "Who Fits? could not intercept the ChatGPT return URL.";
  return `ChatGPT sign-in failed (${error}).`;
}

export function isOAuthCallbackUrl(url: string | undefined, extensionUrl?: string): boolean {
  if (!url) return false;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  const hasResult =
    parsed.searchParams.has("code") || parsed.searchParams.has("error") || parsed.searchParams.has("client_id");
  if (!hasResult) return false;
  if (parsed.hostname === "127.0.0.1" && parsed.pathname === "/auth/callback") return true;
  if (extensionUrl) {
    try {
      const ext = new URL(extensionUrl);
      return parsed.protocol === "chrome-extension:" && parsed.pathname === ext.pathname;
    } catch {
      return false;
    }
  }
  return parsed.protocol === "chrome-extension:" && parsed.pathname.endsWith(`/${CALLBACK_PAGE}`);
}

export function loopbackRedirectRule(extensionUrl: string, tabId: number): chrome.declarativeNetRequest.Rule {
  return {
    id: LOOPBACK_REDIRECT_RULE_ID,
    priority: 1,
    action: {
      type: "redirect",
      redirect: { regexSubstitution: `${extensionUrl}\\1` },
    },
    condition: {
      regexFilter: "^http://127\\.0\\.0\\.1:1455/auth/callback(\\?.*)?$",
      resourceTypes: ["main_frame"],
      tabIds: [tabId],
    },
  };
}

export async function installLoopbackRedirect(tabId: number): Promise<void> {
  const extensionUrl = chrome.runtime.getURL(CALLBACK_PAGE);
  await chrome.declarativeNetRequest.updateSessionRules({
    removeRuleIds: [LOOPBACK_REDIRECT_RULE_ID],
    addRules: [loopbackRedirectRule(extensionUrl, tabId)],
  });
}

export async function removeLoopbackRedirect(): Promise<void> {
  await chrome.declarativeNetRequest.updateSessionRules({
    removeRuleIds: [LOOPBACK_REDIRECT_RULE_ID],
  }).catch(() => undefined);
}

function parseScopes(raw: unknown): string[] {
  if (typeof raw !== "string") return [];
  return raw.split(/[+\s]+/).filter(Boolean);
}

export function buildAuthorizeUrl(opts: {
  clientId: string;
  hostId: string;
  state: string;
  nonce: string;
  codeChallenge: string;
  idTokenHint?: string;
  loginHint?: string;
}): URL {
  const url = new URL(AUTH_AUTHORIZE);
  url.searchParams.set("client_id", opts.clientId);
  url.searchParams.set("ext_agent_host_id", opts.hostId);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("redirect_uri", CALLBACK_URI);
  url.searchParams.set("scope", SCOPES);
  url.searchParams.set("resource", RESOURCE);
  url.searchParams.set("state", opts.state);
  url.searchParams.set("nonce", opts.nonce);
  url.searchParams.set("code_challenge_method", "S256");
  url.searchParams.set("code_challenge", opts.codeChallenge);
  if (opts.clientId === DYNAMIC_CLIENT_ID) url.searchParams.set("agent_name_hint", AGENT_NAME);
  if (opts.idTokenHint) url.searchParams.set("id_token_hint", opts.idTokenHint);
  if (opts.loginHint) url.searchParams.set("login_hint", opts.loginHint);
  return url;
}

export async function hostIdFor(kv: Kv, host: Pick<OAuthHost, "crypto">): Promise<string> {
  const stored = await kv.get(["chatgptHostId"]);
  if (typeof stored.chatgptHostId === "string" && stored.chatgptHostId.startsWith("urn:uuid:")) {
    return stored.chatgptHostId;
  }
  const id = `urn:uuid:${host.crypto.randomUUID()}`;
  await kv.set({ chatgptHostId: id });
  return id;
}

export async function loadChatGptAuth(kv: Kv): Promise<ChatGptAuth | null> {
  const stored = await kv.get(["chatgptAuth"]);
  const auth = stored.chatgptAuth;
  if (!auth || typeof auth !== "object") return null;
  return auth as ChatGptAuth;
}

async function discovery(host: Pick<OAuthHost, "fetch">): Promise<Discovery> {
  if (discoveryCache) return discoveryCache;
  const response = await host.fetch(AUTH_DISCOVERY);
  discoveryCache = (await response.json()) as Discovery;
  return discoveryCache;
}

async function verifyIdToken(
  host: Pick<OAuthHost, "fetch" | "crypto" | "now">,
  idToken: string,
  expected: { audience: string; nonce: string; issuer: string },
): Promise<{ sub: string; email: string }> {
  const parts = idToken.split(".");
  if (parts.length !== 3) throw new Error("invalid_id_token");
  const header = decodeJson(parts[0] ?? "");
  const payload = decodeJson(parts[1] ?? "");
  const kid = typeof header.kid === "string" ? header.kid : "";
  const disc = await discovery(host);
  const jwksUri = disc.jwks_uri ?? "https://auth.openai.com/.well-known/jwks.json";
  const jwks = (await (await host.fetch(jwksUri)).json()) as { keys?: JsonWebKey[] };
  const jwk = (jwks.keys ?? []).find((key) => (key as { kid?: string }).kid === kid) ?? jwks.keys?.[0];
  if (!jwk) throw new Error("invalid_id_token");
  const key = await host.crypto.subtle.importKey(
    "jwk",
    jwk,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["verify"],
  );
  const valid = await host.crypto.subtle.verify(
    "RSASSA-PKCS1-v1_5",
    key,
    fromB64url(parts[2] ?? ""),
    new TextEncoder().encode(`${parts[0]}.${parts[1]}`),
  );
  if (!valid) throw new Error("invalid_id_token");
  const iss = payload.iss;
  const aud = payload.aud;
  const nonce = payload.nonce;
  const exp = payload.exp;
  const sub = payload.sub;
  const email = payload.email;
  if (iss !== expected.issuer) throw new Error("invalid_id_token");
  const audience = Array.isArray(aud) ? aud : [aud];
  if (!audience.includes(expected.audience)) throw new Error("invalid_id_token");
  if (nonce !== expected.nonce) throw new Error("invalid_id_token");
  if (typeof exp !== "number" || exp * 1000 <= host.now()) throw new Error("invalid_id_token");
  if (typeof sub !== "string") throw new Error("invalid_id_token");
  return { sub, email: typeof email === "string" ? email : "" };
}

function formBody(params: Record<string, string>): string {
  return new URLSearchParams(params).toString();
}

function asAuth(
  data: Record<string, unknown>,
  extras: { clientId: string; hostId: string; identity: { sub: string; email: string }; now: number },
): ChatGptAuth {
  const scopes = parseScopes(data.scope);
  const expiresIn = typeof data.expires_in === "number" ? data.expires_in : 3600;
  return {
    email: extras.identity.email,
    issuer: "https://auth.openai.com",
    subject: extras.identity.sub,
    client_id: extras.clientId,
    ext_agent_host_id: extras.hostId,
    id_token: typeof data.id_token === "string" ? data.id_token : "",
    access_token: typeof data.access_token === "string" ? data.access_token : "",
    refresh_token: typeof data.refresh_token === "string" ? data.refresh_token : "",
    token_type: typeof data.token_type === "string" ? data.token_type : "Bearer",
    expires_at: extras.now + expiresIn * 1000,
    scopes,
    saved_at: new Date(extras.now).toISOString(),
  };
}

function clearedAuth(auth: ChatGptAuth): ChatGptAuth {
  return { ...auth, access_token: "", refresh_token: "", id_token: "", expires_at: 0, saved_at: new Date().toISOString() };
}

export async function signInWithChatGpt(host: OAuthHost, kv: Kv): Promise<ChatGptSession> {
  const hostId = await hostIdFor(kv, host);
  const existing = await loadChatGptAuth(kv);
  const clientId = existing?.client_id && existing.client_id !== DYNAMIC_CLIENT_ID ? existing.client_id : DYNAMIC_CLIENT_ID;
  const state = base64Url(host.randomBytes(16));
  const nonce = base64Url(host.randomBytes(16));
  const verifier = base64Url(host.randomBytes(32));
  const challenge = base64Url(new Uint8Array(await host.crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier))));
  const url = buildAuthorizeUrl({
    clientId,
    hostId,
    state,
    nonce,
    codeChallenge: challenge,
    idTokenHint: existing?.id_token || undefined,
    loginHint: existing?.email || undefined,
  });
  const tabId = await host.openTab(url.toString());
  let callbackUrl = "";
  try {
    callbackUrl = await host.waitForCallback(tabId);
  } finally {
    await host.closeTab(tabId).catch(() => undefined);
  }
  const callback = new URL(callbackUrl);
  if (callback.searchParams.get("error") === "access_denied") {
    throw new Error("access_denied");
  }
  if (callback.searchParams.get("state") !== state) throw new Error("oauth_state");
  const issued = callback.searchParams.get("client_id") || (clientId === DYNAMIC_CLIENT_ID ? "" : clientId);
  if (!issued || issued === DYNAMIC_CLIENT_ID) throw new Error("oauth_client");
  if (clientId !== DYNAMIC_CLIENT_ID && issued !== clientId) throw new Error("oauth_client");
  const tokenRes = await host.fetch(AUTH_TOKEN, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
    body: formBody({
      grant_type: "authorization_code",
      client_id: issued,
      code: callback.searchParams.get("code") ?? "",
      code_verifier: verifier,
      redirect_uri: CALLBACK_URI,
      resource: RESOURCE,
    }),
  });
  const tokenJson = (await tokenRes.json()) as Record<string, unknown>;
  if (!tokenRes.ok) throw new Error(typeof tokenJson.error === "string" ? tokenJson.error : "oauth_token");
  const idToken = typeof tokenJson.id_token === "string" ? tokenJson.id_token : "";
  const identity = await verifyIdToken(host, idToken, {
    audience: issued,
    nonce,
    issuer: "https://auth.openai.com",
  });
  const auth = asAuth(tokenJson, { clientId: issued, hostId, identity, now: host.now() });
  await kv.set({ chatgptAuth: auth, chatgptHostId: hostId });
  return { email: auth.email, planUsage: planUsageEnabled(auth), auth };
}

async function doRefresh(host: OAuthHost, kv: Kv): Promise<ChatGptAuth> {
  const existing = await loadChatGptAuth(kv);
  if (!existing?.refresh_token) throw new Error("invalid_grant");
  const tokenRes = await host.fetch(AUTH_TOKEN, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
    body: formBody({
      grant_type: "refresh_token",
      client_id: existing.client_id,
      refresh_token: existing.refresh_token,
      resource: RESOURCE,
    }),
  });
  const tokenJson = (await tokenRes.json().catch(() => ({}))) as Record<string, unknown>;
  const err = typeof tokenJson.error === "string" ? tokenJson.error : "";
  if (
    !tokenRes.ok &&
    (err === "invalid_grant" ||
      err === "invalid_refresh_token" ||
      err === "token_expired" ||
      err === "refresh_token_expired" ||
      err === "refresh_token_invalidated" ||
      err === "refresh_token_reused")
  ) {
    await kv.set({ chatgptAuth: clearedAuth(existing) });
    throw new Error("invalid_grant");
  }
  if (!tokenRes.ok) throw new Error(err || "oauth_token");
  const auth = asAuth(tokenJson, {
    clientId: existing.client_id,
    hostId: existing.ext_agent_host_id,
    identity: { sub: existing.subject, email: existing.email },
    now: host.now(),
  });
  if (!auth.id_token) auth.id_token = existing.id_token;
  if (!auth.refresh_token) auth.refresh_token = existing.refresh_token;
  await kv.set({ chatgptAuth: auth });
  return auth;
}

export async function refreshChatGpt(host: OAuthHost, kv: Kv): Promise<ChatGptAuth> {
  if (refreshLock) return refreshLock;
  refreshLock = doRefresh(host, kv).finally(() => {
    refreshLock = null;
  });
  return refreshLock;
}

export async function disconnectChatGpt(host: OAuthHost, kv: Kv): Promise<void> {
  const existing = await loadChatGptAuth(kv);
  if (existing?.refresh_token) {
    const disc = await discovery(host);
    const endpoint = disc.revocation_endpoint ?? "https://auth.openai.com/api/accounts/oauth/revoke";
    await host.fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: formBody({
        token: existing.refresh_token,
        token_type_hint: "refresh_token",
        client_id: existing.client_id,
      }),
    });
  }
  if (existing) await kv.set({ chatgptAuth: clearedAuth(existing) });
}

export function chromeLocalKv(): Kv {
  return {
    async get(keys) {
      return chrome.storage.local.get(keys);
    },
    async set(values) {
      await chrome.storage.local.set(values);
    },
    async remove(keys) {
      await chrome.storage.local.remove(keys);
    },
  };
}

export function createChromeOAuthHost(): OAuthHost {
  return {
    crypto,
    now: () => Date.now(),
    fetch: globalThis.fetch.bind(globalThis),
    randomBytes(size) {
      return crypto.getRandomValues(new Uint8Array(size));
    },
    async openTab(url) {
      const tab = await chrome.tabs.create({ url: "about:blank", active: true });
      if (tab.id == null) throw new Error("oauth_tab");
      try {
        await installLoopbackRedirect(tab.id);
        await chrome.tabs.update(tab.id, { url });
      } catch (error) {
        await removeLoopbackRedirect();
        await chrome.tabs.remove(tab.id).catch(() => undefined);
        throw error instanceof Error && error.message === "oauth_tab" ? error : new Error("oauth_redirect");
      }
      return tab.id;
    },
    async closeTab(id) {
      await removeLoopbackRedirect();
      await chrome.tabs.remove(id).catch(() => undefined);
    },
    async waitForCallback(tabId) {
      return waitForLoopbackCallback(tabId);
    },
  };
}

export function waitForLoopbackCallback(tabId: number, timeoutMs = 300_000): Promise<string> {
  const extensionUrl = chrome.runtime.getURL(CALLBACK_PAGE);
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      stop();
      reject(new Error("oauth_timeout"));
    }, timeoutMs);
    function consider(url: string | undefined, eventTabId?: number) {
      if (!isOAuthCallbackUrl(url, extensionUrl)) return;
      if (eventTabId != null && eventTabId !== tabId && !url?.startsWith("chrome-extension:")) return;
      stop();
      resolve(url!);
    }
    function onNav(details: { tabId: number; url?: string }) {
      consider(details.url, details.tabId);
    }
    function onUpdated(_id: number, change: { url?: string }, tab: { id?: number; url?: string }) {
      consider(change.url ?? tab.url, tab.id ?? _id);
    }
    function stop() {
      clearTimeout(timer);
      chrome.webNavigation.onBeforeNavigate.removeListener(onNav);
      chrome.webNavigation.onErrorOccurred.removeListener(onNav);
      chrome.webNavigation.onCommitted.removeListener(onNav);
      chrome.webNavigation.onCompleted.removeListener(onNav);
      chrome.tabs.onUpdated.removeListener(onUpdated);
    }
    chrome.webNavigation.onBeforeNavigate.addListener(onNav);
    chrome.webNavigation.onErrorOccurred.addListener(onNav);
    chrome.webNavigation.onCommitted.addListener(onNav);
    chrome.webNavigation.onCompleted.addListener(onNav);
    chrome.tabs.onUpdated.addListener(onUpdated);
  });
}
