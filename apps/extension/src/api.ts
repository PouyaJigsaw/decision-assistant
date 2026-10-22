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

function storedToken(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

export function chromeTokenStore(): TokenStore {
  return {
    async get() {
      const local = await chrome.storage.local.get("sessionToken");
      const localToken = storedToken(local.sessionToken);
      if (localToken) return localToken;
      const session = await chrome.storage.session.get("sessionToken");
      const sessionToken = storedToken(session.sessionToken);
      if (!sessionToken) return null;
      await chrome.storage.local.set({ sessionToken });
      await chrome.storage.session.remove("sessionToken");
      return sessionToken;
    },
    async set(token: string) {
      await chrome.storage.local.set({ sessionToken: token });
      await chrome.storage.session.remove("sessionToken");
    },
    async clear() {
      await chrome.storage.local.remove("sessionToken");
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
    async signup(email: string, password: string) {
      const data = await request("/v1/users", {
        method: "POST",
        body: JSON.stringify({ email, password }),
      });
      await tokenStore.set(data.token);
      return data;
    },
    async me() {
      return request("/v1/me");
    },
    async logout() {
      try {
        await request("/v1/session", { method: "DELETE" });
      } finally {
        await tokenStore.clear();
      }
    },
    async listRoles() {
      return request("/v1/roles");
    },
    async deleteRoles() {
      return request("/v1/roles", { method: "DELETE" });
    },
    async getCurrentRubric(roleId: string) {
      return request(`/v1/roles/${roleId}/rubrics/current`);
    },
    async createRole(title: string, extras: { company?: string; summary?: string } = {}) {
      return request("/v1/roles", {
        method: "POST",
        body: JSON.stringify({ title, company: extras.company ?? "", summary: extras.summary ?? "" }),
      });
    },
    async draftRubric(
      roleId: string,
      notes: string,
      completion?: { model: string; text: string; inputTokens: number; outputTokens: number },
      extras: { title?: string; company?: string } = {},
    ) {
      return request(`/v1/roles/${roleId}/rubric-drafts`, {
        method: "POST",
        body: JSON.stringify({
          notes,
          ...(completion ? { completion } : {}),
          ...(extras.title ? { title: extras.title } : {}),
          ...(extras.company ? { company: extras.company } : {}),
        }),
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
      candidateName?: string;
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
          candidateName: body.candidateName,
        }),
      });
    },
    async postComparison(
      id: string,
      completion: { model: string; text: string; inputTokens: number; outputTokens: number },
    ) {
      return request(`/v1/evaluations/${id}/comparison`, {
        method: "POST",
        body: JSON.stringify(completion),
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
    async getEvaluation(id: string) {
      return request(`/v1/evaluations/${id}`);
    },
    async listEvaluations() {
      return request("/v1/evaluations");
    },
    async deleteEvaluations(roleId?: string) {
      const path = roleId ? `/v1/evaluations?roleId=${encodeURIComponent(roleId)}` : "/v1/evaluations";
      return request(path, { method: "DELETE" });
    },
  };
}

export const API_BASE_URL = apiOrigin();
