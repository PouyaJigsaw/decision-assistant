import { apiOrigin } from "./origin";

export type TokenStore = {
  get(): Promise<string | null>;
  set(token: string): Promise<void>;
  clear(): Promise<void>;
};

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly body: unknown,
  ) {
    super(`API ${status}`);
    this.name = "ApiError";
  }
}

export function chromeTokenStore(): TokenStore {
  return {
    async get() {
      const stored = await chrome.storage.session.get("sessionToken");
      return typeof stored.sessionToken === "string" ? stored.sessionToken : null;
    },
    async set(token: string) {
      await chrome.storage.session.set({ sessionToken: token });
    },
    async clear() {
      await chrome.storage.session.remove("sessionToken");
    },
  };
}

export function createApi(baseUrl: string, tokenStore: TokenStore) {
  async function request(path: string, init: RequestInit = {}) {
    const headers = new Headers(init.headers);
    const token = await tokenStore.get();
    if (token) headers.set("Authorization", `Bearer ${token}`);
    if (init.body && !headers.has("content-type")) headers.set("content-type", "application/json");
    const res = await fetch(`${baseUrl}${path}`, { ...init, headers });
    if (res.status === 401) await tokenStore.clear();
    if (!res.ok) {
      const body = await res.json().catch(() => null);
      throw new ApiError(res.status, body);
    }
    if (res.status === 204) return null;
    return res.json();
  }

  return {
    async login(email: string, password: string) {
      const data = await request("/v1/session", {
        method: "POST",
        body: JSON.stringify({ email, password }),
      });
      await tokenStore.set(data.token);
      return data;
    },
    async me() {
      return request("/v1/me");
    },
    async createRole(title: string) {
      return request("/v1/roles", { method: "POST", body: JSON.stringify({ title }) });
    },
    async draftRubric(roleId: string, notes: string) {
      return request(`/v1/roles/${roleId}/rubric-drafts`, {
        method: "POST",
        body: JSON.stringify({ notes }),
      });
    },
    async approveRubric(roleId: string, criteria: unknown[]) {
      return request(`/v1/roles/${roleId}/rubrics`, {
        method: "POST",
        body: JSON.stringify({ criteria }),
      });
    },
    async evaluate(body: {
      roleId: string;
      rubricVersionId: string;
      approvedText: string;
      keepExtracts: boolean;
      comparisonEnabled: boolean;
      idempotencyKey?: string;
    }) {
      const headers = new Headers();
      if (body.idempotencyKey) headers.set("Idempotency-Key", body.idempotencyKey);
      return request("/v1/evaluations", {
        method: "POST",
        headers,
        body: JSON.stringify({
          roleId: body.roleId,
          rubricVersionId: body.rubricVersionId,
          approvedText: body.approvedText,
          keepExtracts: body.keepExtracts,
          comparisonEnabled: body.comparisonEnabled,
        }),
      });
    },
    async correct(id: string, action: string) {
      return request(`/v1/evaluations/${id}/corrections`, {
        method: "POST",
        body: JSON.stringify({ action }),
      });
    },
    async saveNote(id: string, notes: string) {
      return request(`/v1/evaluations/${id}`, {
        method: "PATCH",
        body: JSON.stringify({ notes }),
      });
    },
    async listEvaluations() {
      return request("/v1/evaluations");
    },
    async deleteEvaluations() {
      return request("/v1/evaluations", { method: "DELETE" });
    },
  };
}

export const API_BASE_URL = apiOrigin();
