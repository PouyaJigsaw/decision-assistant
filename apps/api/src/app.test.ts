import { sampleRubric } from "@decision-assistant/domain";
import { describe, expect, it } from "vitest";
import { createTestApp, signIn } from "./app.test-helpers";
import { trialUses } from "./db/schema";
import { FakeLlm } from "./providers/fake-llm";

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

describe("roles and rubrics", () => {
  it("versions an approved rubric and rejects a protected prompt", async () => {
    const { app } = createTestApp();
    const { headers } = await signIn(app);

    const created = await app.request("/v1/roles", {
      method: "POST",
      headers,
      body: JSON.stringify({ title: "Senior backend engineer" }),
    });
    expect(created.status).toBe(201);
    const role = await created.json();
    expect(role).toEqual({ id: expect.any(String), title: "Senior backend engineer" });

    const first = await app.request(`/v1/roles/${role.id}/rubrics`, {
      method: "POST",
      headers,
      body: JSON.stringify({ criteria: sampleRubric }),
    });
    expect(first.status).toBe(201);
    expect(await first.json()).toEqual({
      id: expect.any(String),
      version: 1,
      criteria: sampleRubric,
    });

    const unsafe = sampleRubric.map((criterion) =>
      criterion.id === "go"
        ? { ...criterion, prompt: "Is the candidate's age over 40?" }
        : criterion,
    );
    const rejected = await app.request(`/v1/roles/${role.id}/rubrics`, {
      method: "POST",
      headers,
      body: JSON.stringify({ criteria: unsafe }),
    });
    expect(rejected.status).toBe(422);
    expect(await rejected.json()).toEqual({
      error: "invalid_rubric",
      reason: "safety",
      term: "age",
    });

    const stillFirst = await app.request(`/v1/roles/${role.id}/rubrics/current`, { headers });
    expect(stillFirst.status).toBe(200);
    expect(await stillFirst.json()).toMatchObject({ version: 1 });

    const second = await app.request(`/v1/roles/${role.id}/rubrics`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        criteria: sampleRubric.map((criterion) =>
          criterion.id === "distributed"
            ? { ...criterion, prompt: "Is there evidence of large-scale distributed systems work?" }
            : criterion,
        ),
      }),
    });
    expect(second.status).toBe(201);
    const v2 = await second.json();
    expect(v2.version).toBe(2);

    const current = await app.request(`/v1/roles/${role.id}/rubrics/current`, { headers });
    expect(current.status).toBe(200);
    expect(await current.json()).toMatchObject({ version: 2, criteria: v2.criteria });
  });
});

describe("POST /v1/roles/:roleId/rubric-drafts", () => {
  it("omits protected draft criteria and does not spend a trial use", async () => {
    const llm = new FakeLlm({
      draftRubric() {
        return {
          model: "fake-llm",
          criteria: [
            { kind: "requirement", label: "Go", prompt: "Is there evidence of Go?" },
            { kind: "preference", label: "Team", prompt: "Does the candidate mention cultural fit?" },
            {
              kind: "disqualifier",
              label: "No ownership",
              prompt: "Has the candidate never owned production systems?",
            },
            { kind: "seniority", label: "Senior", prompt: "How closely does seniority match senior?" },
          ],
          usage: { inputTokens: 1842, outputTokens: 610 },
        };
      },
    });
    const { app, db } = createTestApp({ llm });
    const { headers } = await signIn(app);
    const created = await app.request("/v1/roles", {
      method: "POST",
      headers,
      body: JSON.stringify({ title: "Senior backend engineer" }),
    });
    const role = await created.json();

    const draft = await app.request(`/v1/roles/${role.id}/rubric-drafts`, {
      method: "POST",
      headers,
      body: JSON.stringify({ notes: "Need Go, ownership, and senior scope." }),
    });
    expect(draft.status).toBe(201);
    expect(await draft.json()).toEqual({
      criteria: [
        { id: "c1", kind: "requirement", label: "Go", prompt: "Is there evidence of Go?" },
        {
          id: "c2",
          kind: "disqualifier",
          label: "No ownership",
          prompt: "Has the candidate never owned production systems?",
        },
        { id: "c3", kind: "seniority", label: "Senior", prompt: "How closely does seniority match senior?" },
      ],
      omitted: ["cultural fit"],
      usage: { inputTokens: 1842, outputTokens: 610 },
      cost: { inputUsd: 0.005526, outputUsd: 0.00915, totalUsd: 0.014676 },
    });

    expect(db.select().from(trialUses).all()).toEqual([]);
    const me = await app.request("/v1/me", { headers });
    expect(await me.json()).toMatchObject({ successCount: 0, usesRemaining: 3 });
  });
});



