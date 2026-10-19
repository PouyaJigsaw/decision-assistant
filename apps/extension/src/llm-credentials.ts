import { loadChatGptAuth, planUsageEnabled, type ChatGptAuth, type Kv } from "./chatgpt-oauth";

export const SESSION_API_KEY = "openaiApiKey";

export type DualKv = { local: Kv; session: Kv };

export type Connection =
  | { kind: "none" }
  | { kind: "api_key" }
  | { kind: "chatgpt"; email: string; planUsage: boolean };

export type RequestCredential = {
  token: string;
  stream: boolean;
  planUsage: boolean;
};

export function chromeDualKv(): DualKv {
  return {
    local: {
      async get(keys) {
        return chrome.storage.local.get(keys);
      },
      async set(values) {
        await chrome.storage.local.set(values);
      },
      async remove(keys) {
        await chrome.storage.local.remove(keys);
      },
    },
    session: {
      async get(keys) {
        return chrome.storage.session.get(keys);
      },
      async set(values) {
        await chrome.storage.session.set(values);
      },
      async remove(keys) {
        await chrome.storage.session.remove(keys);
      },
    },
  };
}

export async function setSessionApiKey(kv: DualKv, key: string): Promise<void> {
  await kv.session.set({ [SESSION_API_KEY]: key.trim() });
}

export async function clearSessionApiKey(kv: DualKv): Promise<void> {
  await kv.session.remove([SESSION_API_KEY]);
}

export async function getSessionApiKey(kv: DualKv): Promise<string | null> {
  const stored = await kv.session.get([SESSION_API_KEY]);
  const value = stored[SESSION_API_KEY];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export async function getConnection(kv: DualKv): Promise<Connection> {
  if (await getSessionApiKey(kv)) return { kind: "api_key" };
  const auth = await loadChatGptAuth(kv.local);
  if (auth && (auth.access_token || auth.client_id)) {
    return { kind: "chatgpt", email: auth.email, planUsage: planUsageEnabled(auth) };
  }
  return { kind: "none" };
}

export function isOpenAiUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.hostname === "api.openai.com" || parsed.hostname === "auth.openai.com";
  } catch {
    return false;
  }
}

export async function credentialForRequest(kv: DualKv, url: string): Promise<RequestCredential | null> {
  if (!isOpenAiUrl(url)) return null;
  const sessionKey = await getSessionApiKey(kv);
  if (sessionKey) return { token: sessionKey, stream: false, planUsage: false };
  const auth = await loadChatGptAuth(kv.local);
  if (auth?.access_token && planUsageEnabled(auth)) {
    return { token: auth.access_token, stream: true, planUsage: true };
  }
  return null;
}

export function chatgptAuthFrom(auth: ChatGptAuth | null): Connection {
  if (!auth) return { kind: "none" };
  return { kind: "chatgpt", email: auth.email, planUsage: planUsageEnabled(auth) };
}
