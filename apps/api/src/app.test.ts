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
