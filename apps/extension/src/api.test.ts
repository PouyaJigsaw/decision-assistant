import { afterEach, describe, expect, it, vi } from "vitest";

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
});
