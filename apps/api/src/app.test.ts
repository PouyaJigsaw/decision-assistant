import { describe, expect, it } from "vitest";
import { createTestApp } from "./app.test-helpers";

describe("GET /v1/health", () => {
  it("reports the database without calling a provider", async () => {
    const { app, jev } = createTestApp();
    const res = await app.request("/v1/health");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(jev.calls).toBe(0);
  });
});

describe("POST /v1/session", () => {
  it("rejects a wrong password and signs in the seeded account", async () => {
    const { app } = createTestApp();

    const denied = await app.request("/v1/session", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "recruiter@example.com", password: "wrong-password" }),
    });
    expect(denied.status).toBe(401);
    expect(await denied.json()).toEqual({ error: "unauthorized" });

    const signedIn = await app.request("/v1/session", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "recruiter@example.com", password: "sitting-password" }),
    });
    expect(signedIn.status).toBe(200);
    const session = await signedIn.json();
    expect(session.token).toEqual(expect.any(String));
    expect(session.token.length).toBeGreaterThan(0);
    expect(session.expiresAt).toEqual(expect.any(String));

    const me = await app.request("/v1/me", {
      headers: { authorization: `Bearer ${session.token}` },
    });
    expect(me.status).toBe(200);
    expect(await me.json()).toEqual({
      email: "recruiter@example.com",
      successCount: 0,
      usesRemaining: 3,
      cap: 3,
    });

    const anonymous = await app.request("/v1/me");
    expect(anonymous.status).toBe(401);
    expect(await anonymous.json()).toEqual({ error: "unauthorized" });
  });
});

