import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

function memoryChrome() {
  const local: Record<string, unknown> = {};
  const session: Record<string, unknown> = {};
  function area(store: Record<string, unknown>) {
    return {
      async get(key: string | string[]) {
        if (Array.isArray(key)) {
          const found: Record<string, unknown> = {};
          for (const item of key) found[item] = store[item];
          return found;
        }
        return { [key]: store[key] };
      },
      async set(values: Record<string, unknown>) {
        Object.assign(store, values);
      },
      async remove(keys: string | string[]) {
        for (const key of Array.isArray(keys) ? keys : [keys]) delete store[key];
      },
    };
  }
  return { local, session, chrome: { storage: { local: area(local), session: area(session) } } };
}

describe("createApi", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("stores the login token and sends it on me, then clears it on 401", async () => {
    const { createApi } = await import("./api");
    let token: string | null = null;
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/v1/session") && init?.method === "POST") {
        expect(JSON.parse(String(init.body))).toEqual({
          email: "recruiter@example.com",
          password: "secret",
        });
        return new Response(JSON.stringify({ token: "tok-1", expiresAt: "2099-01-01T00:00:00.000Z" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      if (url.endsWith("/v1/me")) {
        expect(new Headers(init?.headers).get("Authorization")).toBe("Bearer tok-1");
        return new Response(JSON.stringify({ error: "unauthorized" }), { status: 401 });
      }
      throw new Error(`unexpected ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const api = createApi("http://127.0.0.1:8787", {
      get: async () => token,
      set: async (value) => {
        token = value;
      },
      clear: async () => {
        token = null;
      },
    });

    await api.login("recruiter@example.com", "secret");
    expect(token).toBe("tok-1");

    await expect(api.me()).rejects.toMatchObject({ status: 401 });
    expect(token).toBeNull();
  });

  it("stores the signup token after POST /v1/users", async () => {
    const { createApi } = await import("./api");
    let token: string | null = null;
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/v1/users") && init?.method === "POST") {
        expect(JSON.parse(String(init.body))).toEqual({
          email: "new.user@example.com",
          password: "long-enough",
        });
        return new Response(JSON.stringify({ token: "tok-signup", expiresAt: "2099-01-01T00:00:00.000Z" }), {
          status: 201,
          headers: { "content-type": "application/json" },
        });
      }
      throw new Error(`unexpected ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const api = createApi("http://127.0.0.1:8787", {
      get: async () => token,
      set: async (value) => {
        token = value;
      },
      clear: async () => {
        token = null;
      },
    });

    await api.signup("new.user@example.com", "long-enough");
    expect(token).toBe("tok-signup");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("sends a client completion with a rubric draft and a comparison", async () => {
    const { createApi } = await import("./api");
    const completion = { model: "gpt-5.4", text: '{"criteria":[]}', inputTokens: 2, outputTokens: 1 };
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/v1/roles/r1/rubric-drafts") && init?.method === "POST") {
        expect(JSON.parse(String(init.body))).toEqual({
          notes: "Need Go.",
          title: "Forward Deployed Engineer",
          company: "AIM",
          completion,
        });
        return new Response(JSON.stringify({ criteria: [] }), {
          status: 201,
          headers: { "content-type": "application/json" },
        });
      }
      if (url.endsWith("/v1/evaluations/e1/comparison") && init?.method === "POST") {
        expect(JSON.parse(String(init.body))).toEqual(completion);
        return new Response(JSON.stringify({ id: "e1" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      throw new Error(`unexpected ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    const api = createApi("http://127.0.0.1:8787", {
      get: async () => "tok-1",
      set: async () => undefined,
      clear: async () => undefined,
    });
    await api.draftRubric("r1", "Need Go.", completion, {
      title: "Forward Deployed Engineer",
      company: "AIM",
    });
    await api.postComparison("e1", completion);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("gets one evaluation from /v1/evaluations/:id", async () => {
    const { createApi } = await import("./api");
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/v1/evaluations/e1")) {
        return new Response(JSON.stringify({ id: "e1", roleTitle: "Senior backend" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      throw new Error(`unexpected ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const api = createApi("http://127.0.0.1:8787", {
      get: async () => "tok-1",
      set: async () => undefined,
      clear: async () => undefined,
    });

    await expect(api.getEvaluation("e1")).resolves.toEqual({ id: "e1", roleTitle: "Senior backend" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("creates a role with title, company, and summary", async () => {
    const { createApi } = await import("./api");
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/v1/roles") && init?.method === "POST") {
        expect(JSON.parse(String(init.body))).toEqual({
          title: "Forward Deployed Engineer",
          company: "AIM",
          summary: "AIM is a deep-tech startup.",
        });
        return new Response(
          JSON.stringify({
            id: "r1",
            title: "Forward Deployed Engineer",
            company: "AIM",
            summary: "AIM is a deep-tech startup.",
          }),
          { status: 201, headers: { "content-type": "application/json" } },
        );
      }
      throw new Error(`unexpected ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const api = createApi("http://127.0.0.1:8787", {
      get: async () => "tok-1",
      set: async () => undefined,
      clear: async () => undefined,
    });

    await expect(
      api.createRole("Forward Deployed Engineer", { company: "AIM", summary: "AIM is a deep-tech startup." }),
    ).resolves.toEqual({
      id: "r1",
      title: "Forward Deployed Engineer",
      company: "AIM",
      summary: "AIM is a deep-tech startup.",
    });
  });

  it("lists roles from GET /v1/roles", async () => {
    const { createApi } = await import("./api");
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/v1/roles")) {
        return new Response(JSON.stringify({ roles: [{ id: "r1", title: "Staff engineer" }] }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      throw new Error(`unexpected ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const api = createApi("http://127.0.0.1:8787", {
      get: async () => "tok-1",
      set: async () => undefined,
      clear: async () => undefined,
    });

    await expect(api.listRoles()).resolves.toEqual({ roles: [{ id: "r1", title: "Staff engineer" }] });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("loads the current rubric from GET /v1/roles/:id/rubrics/current", async () => {
    const { createApi } = await import("./api");
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/v1/roles/role-1/rubrics/current")) {
        return new Response(JSON.stringify({ id: "rv1", version: 2, criteria: [{ id: "go" }] }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      throw new Error(`unexpected ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const api = createApi("http://127.0.0.1:8787", {
      get: async () => "tok-1",
      set: async () => undefined,
      clear: async () => undefined,
    });

    await expect(api.getCurrentRubric("role-1")).resolves.toEqual({
      id: "rv1",
      version: 2,
      criteria: [{ id: "go" }],
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("logs out with DELETE /v1/session and clears the token", async () => {
    const { createApi } = await import("./api");
    let token: string | null = "tok-1";
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/v1/session") && init?.method === "DELETE") {
        expect(new Headers(init.headers).get("Authorization")).toBe("Bearer tok-1");
        return new Response(null, { status: 204 });
      }
      throw new Error(`unexpected ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const api = createApi("http://127.0.0.1:8787", {
      get: async () => token,
      set: async (value) => {
        token = value;
      },
      clear: async () => {
        token = null;
      },
    });

    await api.logout();
    expect(token).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe("chromeTokenStore", () => {
  let local: Record<string, unknown>;
  let session: Record<string, unknown>;

  beforeEach(() => {
    const memory = memoryChrome();
    local = memory.local;
    session = memory.session;
    vi.stubGlobal("chrome", memory.chrome);
  });

  it("keeps the token in local storage so a later store still sees it", async () => {
    const { chromeTokenStore } = await import("./api");
    await chromeTokenStore().set("tok-1");
    expect(local.sessionToken).toBe("tok-1");
    expect(session.sessionToken).toBeUndefined();
    await expect(chromeTokenStore().get()).resolves.toBe("tok-1");
  });

  it("copies a leftover session token into local storage", async () => {
    const { chromeTokenStore } = await import("./api");
    session.sessionToken = "tok-old";
    await expect(chromeTokenStore().get()).resolves.toBe("tok-old");
    expect(local.sessionToken).toBe("tok-old");
    expect(session.sessionToken).toBeUndefined();
  });

  it("clears the local token", async () => {
    const { chromeTokenStore } = await import("./api");
    local.sessionToken = "tok-1";
    session.sessionToken = "tok-session";
    await chromeTokenStore().clear();
    await expect(chromeTokenStore().get()).resolves.toBeNull();
    expect(local.sessionToken).toBeUndefined();
    expect(session.sessionToken).toBeUndefined();
  });
});
