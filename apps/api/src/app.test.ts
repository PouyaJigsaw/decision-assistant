import { sampleRubric } from "@decision-assistant/domain";
import type { Hono } from "hono";
import { describe, expect, it } from "vitest";
import { getEvaluation } from "./app";
import { createTestApp, signIn } from "./app.test-helpers";
import { evaluations, trialUses } from "./db/schema";
import { FakeJev } from "./providers/fake-jev";
import { FakeLlm } from "./providers/fake-llm";

const APPROVED_TEXT = "Staff engineer. Led the payments API in Go for four years.";

const contactJevPayload = {
  model: "jev-1.13.0",
  answers: {
    go: {
      type: "choice",
      choice: "match",
      confidence: 0.9,
      probabilities: { match: 0.7, mismatch: 0.1, no_evidence: 0.1, contradictory: 0.1 },
    },
    distributed: {
      type: "choice",
      choice: "match",
      confidence: 0.85,
      probabilities: { match: 0.7, mismatch: 0.1, no_evidence: 0.1, contradictory: 0.1 },
    },
    "no-ownership": {
      type: "choice",
      choice: "mismatch",
      confidence: 0.8,
      probabilities: { match: 0.1, mismatch: 0.7, no_evidence: 0.1, contradictory: 0.1 },
    },
    seniority: {
      type: "score",
      score: 1.15,
      confidence: 0.8,
      probabilities: { "0": 0.05, "1": 0.8, "2": 0.1, "3": 0.05 },
    },
  },
  usage: { input_tokens: 2180, output_tokens: 36 },
};

function contactProviders() {
  return {
    jev: new FakeJev(() => ({ ok: true, model: "jev-1.13.0", payload: contactJevPayload })),
    llm: new FakeLlm({
      compare() {
        return {
          model: "fake-llm",
          excerpts: [
            { criterionId: "go", excerpt: "Led the payments API in Go for four years." },
            { criterionId: "distributed", excerpt: "not in the profile" },
          ],
          usage: { inputTokens: 412, outputTokens: 88 },
        };
      },
    }),
  };
}

async function approveRubric(app: Hono, headers: Record<string, string>) {
  const created = await app.request("/v1/roles", {
    method: "POST",
    headers,
    body: JSON.stringify({ title: "Senior backend engineer" }),
  });
  const role = await created.json();
  const approved = await app.request(`/v1/roles/${role.id}/rubrics`, {
    method: "POST",
    headers,
    body: JSON.stringify({ criteria: sampleRubric }),
  });
  const rubric = await approved.json();
  return { role, rubric };
}

function evaluateBody(roleId: string, rubricVersionId: string, overrides: Record<string, unknown> = {}) {
  return {
    roleId,
    rubricVersionId,
    approvedText: APPROVED_TEXT,
    keepExtracts: true,
    comparisonEnabled: true,
    ...overrides,
  };
}

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

describe("POST /v1/evaluations", () => {
  it("evaluates a profile, grounds excerpts, and spends one trial use", async () => {
    const { jev, llm } = contactProviders();
    const { app, db } = createTestApp({ jev, llm });
    const { headers } = await signIn(app);

    const { role, rubric } = await approveRubric(app, headers);
    const evaluated = await app.request("/v1/evaluations", {
      method: "POST",
      headers: { ...headers, "Idempotency-Key": "11111111-1111-4111-8111-111111111111" },
      body: JSON.stringify(evaluateBody(role.id, rubric.id)),
    });
    expect(evaluated.status).toBe(200);
    const body = await evaluated.json();
    expect(body).toMatchObject({
      status: "success",
      action: "contact",
      countsAsUse: true,
      usesRemaining: 2,
      replayed: false,
      jev: { model: "jev-1.13.0", cost: { outputUsd: 0 } },
    });
    expect(body.answers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          criterionId: "go",
          excerpt: null,
          llmExcerpt: "Led the payments API in Go for four years.",
        }),
        expect.objectContaining({
          criterionId: "distributed",
          excerpt: null,
          llmExcerpt: null,
        }),
      ]),
    );
    expect(jev.calls).toBe(1);
    expect(llm.calls).toBe(1);
    expect(db.select().from(evaluations).get()?.approvedText).toBe(APPROVED_TEXT);
  });

  it("replays the same key and body without calling Jev again", async () => {
    const { jev, llm } = contactProviders();
    const { app } = createTestApp({ jev, llm });
    const { headers } = await signIn(app);
    const { role, rubric } = await approveRubric(app, headers);
    const key = "22222222-2222-4222-8222-222222222222";
    const payload = evaluateBody(role.id, rubric.id);

    const first = await app.request("/v1/evaluations", {
      method: "POST",
      headers: { ...headers, "Idempotency-Key": key },
      body: JSON.stringify(payload),
    });
    expect(first.status).toBe(200);
    const original = await first.json();

    const replay = await app.request("/v1/evaluations", {
      method: "POST",
      headers: { ...headers, "Idempotency-Key": key },
      body: JSON.stringify(payload),
    });
    expect(replay.status).toBe(200);
    expect(await replay.json()).toMatchObject({
      id: original.id,
      replayed: true,
      usesRemaining: 2,
    });
    expect(jev.calls).toBe(1);
  });

  it("rejects the same key with a different approved text", async () => {
    const { jev, llm } = contactProviders();
    const { app } = createTestApp({ jev, llm });
    const { headers } = await signIn(app);
    const { role, rubric } = await approveRubric(app, headers);
    const key = "33333333-3333-4333-8333-333333333333";

    const first = await app.request("/v1/evaluations", {
      method: "POST",
      headers: { ...headers, "Idempotency-Key": key },
      body: JSON.stringify(evaluateBody(role.id, rubric.id)),
    });
    expect(first.status).toBe(200);
    expect(jev.calls).toBe(1);

    const conflict = await app.request("/v1/evaluations", {
      method: "POST",
      headers: { ...headers, "Idempotency-Key": key },
      body: JSON.stringify(evaluateBody(role.id, rubric.id, { approvedText: "Different profile text." })),
    });
    expect(conflict.status).toBe(409);
    expect(await conflict.json()).toEqual({ error: "idempotency_conflict" });
    expect(jev.calls).toBe(1);
  });

  it("keeps the action when keepExtracts is false and stores no approved text", async () => {
    const { jev, llm } = contactProviders();
    const { app, db } = createTestApp({ jev, llm });
    const { headers } = await signIn(app);
    const { role, rubric } = await approveRubric(app, headers);

    const evaluated = await app.request("/v1/evaluations", {
      method: "POST",
      headers: { ...headers, "Idempotency-Key": "44444444-4444-4444-8444-444444444444" },
      body: JSON.stringify(evaluateBody(role.id, rubric.id, { keepExtracts: false })),
    });
    expect(evaluated.status).toBe(200);
    const body = await evaluated.json();
    expect(body.action).toBe("contact");
    const row = getEvaluation(db, body.id);
    expect(row?.approvedText).toBeNull();
    expect(row?.action).toBe("contact");
  });

  it("returns the stored LLM price after the env price changes", async () => {
    const { jev, llm } = contactProviders();
    const first = createTestApp({ jev, llm });
    const { headers } = await signIn(first.app);
    const { role, rubric } = await approveRubric(first.app, headers);
    const evaluated = await first.app.request("/v1/evaluations", {
      method: "POST",
      headers: { ...headers, "Idempotency-Key": "55555555-5555-4555-8555-555555555555" },
      body: JSON.stringify(evaluateBody(role.id, rubric.id)),
    });
    const created = await evaluated.json();

    const reread = createTestApp({
      db: first.db,
      env: { llmPrice: { inputUsdPerMillion: 1, outputUsdPerMillion: 1 } },
    });
    const { headers: nextHeaders } = await signIn(reread.app);
    const got = await reread.app.request(`/v1/evaluations/${created.id}`, { headers: nextHeaders });
    expect(got.status).toBe(200);
    expect(await got.json()).toMatchObject({
      id: created.id,
      replayed: false,
      llm: {
        price: { inputUsdPerMillion: 3, outputUsdPerMillion: 15 },
        cost: { inputUsd: 0.001236, outputUsd: 0.00132, totalUsd: 0.002556 },
      },
    });
  });
});



