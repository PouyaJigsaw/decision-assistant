import { sampleRubric } from "@decision-assistant/domain";
import { eq } from "drizzle-orm";
import type { Hono } from "hono";
import { describe, expect, it } from "vitest";
import { getEvaluation } from "./app";
import { createTestApp, signIn } from "./app.test-helpers";
import { evaluations, roles, trialUses, users } from "./db/schema";
import { FakeJev } from "./providers/fake-jev";
import { FakeLlm } from "./providers/fake-llm";
import { createRuntimeProviders } from "./providers/runtime-fakes";

const APPROVED_TEXT = "Staff engineer. Led the payments API in Go for four years.";

function enoughNotes() {
  return Array.from({ length: 150 }, (_, index) => `requirement${index}`).join(" ");
}

const DRAFT_COMPLETION_TEXT = JSON.stringify({
  criteria: [
    { kind: "requirement", label: "Go", prompt: "Is there evidence of Go?" },
    { kind: "preference", label: "Team", prompt: "Does the candidate mention cultural fit?" },
    {
      kind: "disqualifier",
      label: "No ownership",
      prompt: "Has the candidate never owned production systems?",
    },
  ],
});

function draftCompletion(text = DRAFT_COMPLETION_TEXT) {
  return { model: "gpt-5.4", text, inputTokens: 1842, outputTokens: 610 };
}

const COMPARE_COMPLETION_TEXT = JSON.stringify({
  answers: [
    { criterionId: "go", result: "match", confidence: 0.91, excerpt: "Led the payments API in Go for four years." },
    { criterionId: "distributed", result: "no_evidence", confidence: 0.8, excerpt: "not in the profile" },
  ],
});

function compareCompletion(text = COMPARE_COMPLETION_TEXT) {
  return { model: "gpt-5.4", text, inputTokens: 412, outputTokens: 88 };
}

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
          answers: [
            { criterionId: "go", result: "match", confidence: 0.91, excerpt: "Led the payments API in Go for four years." },
            { criterionId: "distributed", result: "no_evidence", confidence: 0.8, excerpt: "not in the profile" },
          ],
          usage: { inputTokens: 412, outputTokens: 88 },
        };
      },
    }),
  };
}

const HOSTED_DRAFT_CRITERIA = [
  { kind: "requirement" as const, label: "Go", prompt: "Is there evidence of Go?" },
  { kind: "preference" as const, label: "Team", prompt: "Does the candidate mention cultural fit?" },
  {
    kind: "disqualifier" as const,
    label: "No ownership",
    prompt: "Has the candidate never owned production systems?",
  },
];

function hostedDraftLlm() {
  return new FakeLlm({
    draftRubric() {
      return {
        model: "fake-llm",
        criteria: HOSTED_DRAFT_CRITERIA,
        usage: { inputTokens: 1842, outputTokens: 610 },
      };
    },
  });
}

async function createRole(app: Hono<any>, headers: Record<string, string>, title = "Senior backend engineer") {
  const created = await app.request("/v1/roles", {
    method: "POST",
    headers,
    body: JSON.stringify({ title }),
  });
  return created.json() as Promise<{ id: string; title: string }>;
}

async function draftHostedRole(app: Hono<any>, headers: Record<string, string>, title: string) {
  const role = await createRole(app, headers, title);
  const draft = await app.request(`/v1/roles/${role.id}/rubric-drafts`, {
    method: "POST",
    headers,
    body: JSON.stringify({ notes: enoughNotes() }),
  });
  return { role, draft };
}

async function approveRubric(app: Hono<any>, headers: Record<string, string>) {
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

describe("runtime fakes", () => {
  it("can complete an evaluate without test-only stubs", async () => {
    const { jev, llm } = createRuntimeProviders();
    const { app } = createTestApp({ jev, llm });
    const { headers } = await signIn(app);
    const { role, rubric } = await approveRubric(app, headers);
    const evaluated = await app.request("/v1/evaluations", {
      method: "POST",
      headers: { ...headers, "Idempotency-Key": "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee" },
      body: JSON.stringify(evaluateBody(role.id, rubric.id)),
    });
    expect(evaluated.status).toBe(200);
    expect(await evaluated.json()).toMatchObject({ status: "success", action: "contact", replayed: false });
  });
});

describe("GET /v1/health", () => {
  it("reports the database without calling a provider", async () => {
    const { app, jev } = createTestApp();
    const res = await app.request("/v1/health");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(jev.calls).toBe(0);
  });
});

describe("public pages", () => {
  it("serves the store listing and privacy policy as HTML", async () => {
    const { app, jev, llm } = createTestApp();
    const home = await app.request("/");
    expect(home.status).toBe(200);
    expect(home.headers.get("content-type")).toMatch(/text\/html/);
    const homeBody = await home.text();
    expect(homeBody).toContain("Who Fits?");
    expect(homeBody).toContain("Screen a LinkedIn profile against a job rubric.");
    expect(homeBody).toContain("/privacy");

    const privacy = await app.request("/privacy");
    expect(privacy.status).toBe(200);
    expect(privacy.headers.get("content-type")).toMatch(/text\/html/);
    const privacyBody = await privacy.text();
    expect(privacyBody).toContain("Privacy policy");
    expect(privacyBody).toContain("TypeSafe");
    expect(privacyBody).toContain("OpenAI");
    expect(privacyBody).toContain("decision-assistant.fly.dev");
    expect(privacyBody).toContain("pouya__1__pournasir@hotmail.com");
    expect(privacyBody).not.toContain("contact the publisher through the Chrome Web Store listing");
    expect(jev.calls).toBe(0);
    expect(llm.calls).toBe(0);
  });
});

describe("CORS for the WXT side panel", () => {
  it("answers a preflight from the Vite origin and does not reflect unknown origins", async () => {
    const { app } = createTestApp();
    const preflight = await app.request("/v1/session", {
      method: "OPTIONS",
      headers: {
        Origin: "http://localhost:3000",
        "Access-Control-Request-Method": "POST",
        "Access-Control-Request-Headers": "content-type",
      },
    });
    expect(preflight.status).toBe(204);
    expect(preflight.headers.get("access-control-allow-origin")).toBe("http://localhost:3000");
    expect(preflight.headers.get("access-control-allow-headers")?.toLowerCase()).toContain("content-type");

    const denied = await app.request("/v1/session", {
      method: "OPTIONS",
      headers: {
        Origin: "https://evil.example",
        "Access-Control-Request-Method": "POST",
      },
    });
    expect(denied.headers.get("access-control-allow-origin")).toBeNull();
  });
});

describe("POST /v1/users", () => {
  it("creates an account, returns a session, and leaves three uses", async () => {
    const { app, jev, llm } = createTestApp();
    const created = await app.request("/v1/users", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "  New.User@Example.com ", password: "long-enough" }),
    });
    expect(created.status).toBe(201);
    const session = await created.json();
    expect(session.token).toEqual(expect.any(String));
    expect(session.token.length).toBeGreaterThan(0);
    expect(session.expiresAt).toEqual(expect.any(String));
    expect(jev.calls).toBe(0);
    expect(llm.calls).toBe(0);

    const me = await app.request("/v1/me", {
      headers: { authorization: `Bearer ${session.token}` },
    });
    expect(me.status).toBe(200);
    expect(await me.json()).toEqual({
      email: "new.user@example.com",
      successCount: 0,
      usesRemaining: null,
      cap: null,
      rolesRemaining: 3,
      roleCap: 3,
    });
  });

  it("rejects a duplicate email without inserting another user", async () => {
    const { app, db } = createTestApp();
    const first = await app.request("/v1/users", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "taken@example.com", password: "long-enough" }),
    });
    expect(first.status).toBe(201);
    const before = db.select().from(users).all().length;

    const duplicate = await app.request("/v1/users", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "Taken@example.com", password: "another-password" }),
    });
    expect(duplicate.status).toBe(409);
    expect(await duplicate.json()).toEqual({ error: "email_taken" });
    expect(db.select().from(users).all()).toHaveLength(before);
  });

  it("rejects a short password or missing email before calling providers", async () => {
    const { app, db, jev, llm } = createTestApp();
    const before = db.select().from(users).all().length;

    const shortPassword = await app.request("/v1/users", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "ok@example.com", password: "short" }),
    });
    expect(shortPassword.status).toBe(422);
    expect(await shortPassword.json()).toEqual({ error: "invalid_credentials" });

    const missingEmail = await app.request("/v1/users", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ password: "long-enough" }),
    });
    expect(missingEmail.status).toBe(422);
    expect(await missingEmail.json()).toEqual({ error: "invalid_credentials" });

    expect(db.select().from(users).all()).toHaveLength(before);
    expect(jev.calls).toBe(0);
    expect(llm.calls).toBe(0);
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
    const remainingMs = Date.parse(session.expiresAt) - Date.now();
    expect(remainingMs).toBeGreaterThan(29 * 24 * 60 * 60 * 1000);
    expect(remainingMs).toBeLessThan(31 * 24 * 60 * 60 * 1000);

    const me = await app.request("/v1/me", {
      headers: { authorization: `Bearer ${session.token}` },
    });
    expect(me.status).toBe(200);
    expect(await me.json()).toEqual({
      email: "recruiter@example.com",
      successCount: 0,
      usesRemaining: null,
      cap: null,
      rolesRemaining: 3,
      roleCap: 3,
    });

    const anonymous = await app.request("/v1/me");
    expect(anonymous.status).toBe(401);
    expect(await anonymous.json()).toEqual({ error: "unauthorized" });
  });
});

describe("GET /v1/roles", () => {
  it("returns the user's roles newest first", async () => {
    const { app, db } = createTestApp();
    const { headers } = await signIn(app);
    const user = db.select().from(users).all()[0];
    db.insert(roles)
      .values([
        { id: "role-old", userId: user.id, title: "Older role", createdAt: 1_000 },
        { id: "role-new", userId: user.id, title: "Newer role", createdAt: 2_000 },
      ])
      .run();

    const listed = await app.request("/v1/roles", { headers });
    expect(listed.status).toBe(200);
    expect(await listed.json()).toEqual({
      roles: [
        { id: "role-new", title: "Newer role", company: "", summary: "" },
        { id: "role-old", title: "Older role", company: "", summary: "" },
      ],
    });
  });

  it("repairs an About the job title from the stored summary", async () => {
    const { app, db } = createTestApp();
    const { headers } = await signIn(app);
    const user = db.select().from(users).all()[0];
    db.insert(roles)
      .values({
        id: "role-about",
        userId: user.id,
        title: "About the job",
        company: "",
        summary:
          "PCT partners with venture-backed technology companies looking for Forward Deployed Engineers (FDEs) who can bridge the gap.",
        createdAt: 3_000,
      })
      .run();

    const listed = await app.request("/v1/roles", { headers });
    expect(await listed.json()).toEqual({
      roles: [
        {
          id: "role-about",
          title: "Forward Deployed Engineers",
          company: "PCT",
          summary: expect.stringContaining("venture-backed"),
        },
      ],
    });
  });

  it("repairs an AIM lead sentence into company plus summary", async () => {
    const { app, db } = createTestApp();
    const { headers } = await signIn(app);
    const user = db.select().from(users).all()[0];
    db.insert(roles)
      .values({
        id: "role-aim",
        userId: user.id,
        title: "AIM is a deep-tech startup building advanced high-power laser systems",
        company: "",
        summary: "",
        createdAt: 4_000,
      })
      .run();

    const listed = await app.request("/v1/roles", { headers });
    expect(await listed.json()).toEqual({
      roles: [
        {
          id: "role-aim",
          title: "AIM",
          company: "AIM",
          summary: expect.stringContaining("deep-tech startup"),
        },
      ],
    });
  });

  it("keeps a typed title when the summary looks like a job posting", async () => {
    const { app } = createTestApp();
    const { headers } = await signIn(app);
    const created = await app.request("/v1/roles", {
      method: "POST",
      headers,
      body: JSON.stringify({
        title: "Forward Deployed Engineer",
        company: "AIM",
        summary:
          "PCT partners with venture-backed technology companies looking for Staff Software Engineers who can bridge the gap.",
      }),
    });
    expect(await created.json()).toMatchObject({
      title: "Forward Deployed Engineer",
      company: "AIM",
    });

    const listed = await app.request("/v1/roles", { headers });
    expect(await listed.json()).toEqual({
      roles: [
        {
          id: expect.any(String),
          title: "Forward Deployed Engineer",
          company: "AIM",
          summary:
            "PCT partners with venture-backed technology companies looking for Staff Software Engineers who can bridge the gap.",
        },
      ],
    });
  });

  it("stores and returns company and summary", async () => {
    const { app } = createTestApp();
    const { headers } = await signIn(app);
    const created = await app.request("/v1/roles", {
      method: "POST",
      headers,
      body: JSON.stringify({
        title: "Forward Deployed Engineer",
        company: "AIM",
        summary: "AIM is a deep-tech startup building evaluation systems.",
      }),
    });
    expect(created.status).toBe(201);
    expect(await created.json()).toEqual({
      id: expect.any(String),
      title: "Forward Deployed Engineer",
      company: "AIM",
      summary: "AIM is a deep-tech startup building evaluation systems.",
    });

    const listed = await app.request("/v1/roles", { headers });
    expect(await listed.json()).toEqual({
      roles: [
        {
          id: expect.any(String),
          title: "Forward Deployed Engineer",
          company: "AIM",
          summary: "AIM is a deep-tech startup building evaluation systems.",
        },
      ],
    });
  });
});

describe("DELETE /v1/roles", () => {
  it("deletes every saved role and keeps evaluation history readable", async () => {
    const { jev, llm } = contactProviders();
    const { app, db } = createTestApp({ jev, llm });
    const { headers } = await signIn(app);
    const { role, rubric } = await approveRubric(app, headers);
    const evaluated = await app.request("/v1/evaluations", {
      method: "POST",
      headers: { ...headers, "Idempotency-Key": "16161616-1616-4161-8161-161616161616" },
      body: JSON.stringify(
        evaluateBody(role.id, rubric.id, {
          approvedText: "Headline\nTim Glaser — CEO at TypeSafe\n\nAbout\nLed the payments API in Go for four years.",
        }),
      ),
    });
    const created = await evaluated.json();
    db.insert(roles)
      .values({ id: "other-role", userId: "someone-else", title: "Other role", createdAt: 1 })
      .run();

    const removed = await app.request("/v1/roles", { method: "DELETE", headers });
    expect(removed.status).toBe(204);

    const listed = await app.request("/v1/roles", { headers });
    expect(await listed.json()).toEqual({ roles: [] });
    expect(db.select().from(roles).all().map((row) => row.id)).toEqual(["other-role"]);

    const history = await app.request("/v1/evaluations", { headers });
    expect(await history.json()).toMatchObject({
      evaluations: [{ id: created.id, roleTitle: "Senior backend engineer", candidateName: "Tim Glaser" }],
    });

    const got = await app.request(`/v1/evaluations/${created.id}`, { headers });
    const body = await got.json();
    expect(body.roleTitle).toBe("Senior backend engineer");
    expect(body.answers.find((answer: { criterionId: string }) => answer.criterionId === "go")?.label).toBe(
      "Go, five or more years",
    );
    expect(body.answers.find((answer: { criterionId: string }) => answer.criterionId === "go")?.prompt).toBe(
      "Is there evidence of at least five years of Go?",
    );
    expect(body.answers.find((answer: { criterionId: string }) => answer.criterionId === "go")?.kind).toBe(
      "requirement",
    );
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
    expect(role).toEqual({
      id: expect.any(String),
      title: "Senior backend engineer",
      company: "",
      summary: "",
    });

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

  it("returns stored job notes with the current rubric", async () => {
    const notes = enoughNotes();
    const { app } = createTestApp();
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
      body: JSON.stringify({ notes, completion: draftCompletion() }),
    });
    expect(draft.status).toBe(201);
    await app.request(`/v1/roles/${role.id}/rubrics`, {
      method: "POST",
      headers,
      body: JSON.stringify({ criteria: sampleRubric }),
    });

    const current = await app.request(`/v1/roles/${role.id}/rubrics/current`, { headers });
    expect(current.status).toBe(200);
    expect(await current.json()).toMatchObject({
      version: 1,
      criteria: sampleRubric,
      notes,
      title: "Senior backend engineer",
    });
  });
});

describe("POST /v1/roles/:roleId/rubric-drafts", () => {
  it("omits protected draft criteria and does not spend a trial use", async () => {
    const { app, db, llm } = createTestApp();
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
      body: JSON.stringify({ notes: enoughNotes(), completion: draftCompletion() }),
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
      ],
      omitted: ["cultural fit"],
      usage: { inputTokens: 1842, outputTokens: 610 },
      cost: { inputUsd: 0, outputUsd: 0, totalUsd: 0 },
    });
    expect(llm.calls).toBe(0);

    expect(db.select().from(trialUses).all()).toEqual([]);
    const me = await app.request("/v1/me", { headers });
    expect(await me.json()).toMatchObject({
      successCount: 0,
      usesRemaining: null,
      cap: null,
      rolesRemaining: 3,
      roleCap: 3,
    });
  });

  it("drafts via the hosted model and spends one role slot", async () => {
    const llm = hostedDraftLlm();
    const { app } = createTestApp({ llm });
    const { headers } = await signIn(app);
    const { draft } = await draftHostedRole(app, headers, "Senior backend engineer");
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
      ],
      omitted: ["cultural fit"],
      usage: { inputTokens: 1842, outputTokens: 610 },
      cost: { inputUsd: 0, outputUsd: 0, totalUsd: 0 },
    });
    expect(llm.calls).toBe(1);
    const me = await app.request("/v1/me", { headers });
    expect(await me.json()).toMatchObject({
      usesRemaining: null,
      cap: null,
      rolesRemaining: 2,
      roleCap: 3,
    });
  });

  it("redrafts a hosted role without spending another slot", async () => {
    const llm = hostedDraftLlm();
    const { app } = createTestApp({ llm });
    const { headers } = await signIn(app);
    const first = await draftHostedRole(app, headers, "Role one");
    expect(first.draft.status).toBe(201);
    const redraft = await app.request(`/v1/roles/${first.role.id}/rubric-drafts`, {
      method: "POST",
      headers,
      body: JSON.stringify({ notes: enoughNotes() }),
    });
    expect(redraft.status).toBe(201);
    expect(llm.calls).toBe(2);
    await draftHostedRole(app, headers, "Role two");
    await draftHostedRole(app, headers, "Role three");
    const fourth = await draftHostedRole(app, headers, "Role four");
    expect(fourth.draft.status).toBe(409);
    expect(await fourth.draft.json()).toEqual({
      error: "trial_cap",
      message: "This trial covered three job roles. Creating another is closed.",
    });
    expect(llm.calls).toBe(4);
  });

  it("refuses a fourth new hosted role and keeps the ledger after delete", async () => {
    const llm = hostedDraftLlm();
    const { app } = createTestApp({ llm });
    const { headers } = await signIn(app);
    for (const title of ["Role one", "Role two", "Role three"]) {
      const { draft } = await draftHostedRole(app, headers, title);
      expect(draft.status).toBe(201);
    }
    expect(llm.calls).toBe(3);
    const fourth = await draftHostedRole(app, headers, "Role four");
    expect(fourth.draft.status).toBe(409);
    expect(await fourth.draft.json()).toEqual({
      error: "trial_cap",
      message: "This trial covered three job roles. Creating another is closed.",
    });
    expect(llm.calls).toBe(3);

    const wiped = await app.request("/v1/roles", { method: "DELETE", headers });
    expect(wiped.status).toBe(204);
    const fifth = await draftHostedRole(app, headers, "Role five");
    expect(fifth.draft.status).toBe(409);
    expect(llm.calls).toBe(3);

    const ownModel = await createRole(app, headers, "Own model role");
    const ownDraft = await app.request(`/v1/roles/${ownModel.id}/rubric-drafts`, {
      method: "POST",
      headers,
      body: JSON.stringify({ notes: enoughNotes(), completion: draftCompletion() }),
    });
    expect(ownDraft.status).toBe(201);
    expect(llm.calls).toBe(3);
  });

  it("does not spend a hosted slot when the hosted model fails", async () => {
    let fail = true;
    const llm = new FakeLlm({
      draftRubric() {
        if (fail) {
          fail = false;
          throw new Error("llm_failed");
        }
        return {
          model: "fake-llm",
          criteria: HOSTED_DRAFT_CRITERIA,
          usage: { inputTokens: 1842, outputTokens: 610 },
        };
      },
    });
    const { app } = createTestApp({ llm });
    const { headers } = await signIn(app);
    const failed = await draftHostedRole(app, headers, "Broken role");
    expect(failed.draft.status).toBe(502);
    expect(await failed.draft.json()).toEqual({ error: "llm_failed" });
    for (const title of ["Role one", "Role two", "Role three"]) {
      const { draft } = await draftHostedRole(app, headers, title);
      expect(draft.status).toBe(201);
    }
    const fourth = await draftHostedRole(app, headers, "Role four");
    expect(fourth.draft.status).toBe(409);
    expect(llm.calls).toBe(4);
  });

  it("lets a stored cap of 100 host more than three role drafts", async () => {
    const llm = hostedDraftLlm();
    const { app, db } = createTestApp({ llm });
    const { headers } = await signIn(app);
    const user = db.select().from(users).where(eq(users.email, "recruiter@example.com")).get();
    db.update(users).set({ trialSuccessCap: 100 }).where(eq(users.id, user!.id)).run();
    for (const title of ["Role one", "Role two", "Role three", "Role four"]) {
      const { draft } = await draftHostedRole(app, headers, title);
      expect(draft.status).toBe(201);
    }
    expect(llm.calls).toBe(4);
  });

  it("keeps hosted drafts open when the trial cap is unlimited", async () => {
    const llm = hostedDraftLlm();
    const { app } = createTestApp({ llm, env: { trialSuccessCap: null } });
    const { headers } = await signIn(app);
    for (const title of ["Role one", "Role two", "Role three", "Role four"]) {
      const { draft } = await draftHostedRole(app, headers, title);
      expect(draft.status).toBe(201);
    }
    expect(llm.calls).toBe(4);
  });

  it("rejects a malformed client completion without calling the hosted model", async () => {
    const llm = hostedDraftLlm();
    const { app } = createTestApp({ llm });
    const { headers } = await signIn(app);
    const role = await createRole(app, headers);
    const draft = await app.request(`/v1/roles/${role.id}/rubric-drafts`, {
      method: "POST",
      headers,
      body: JSON.stringify({ notes: enoughNotes(), completion: { model: "gpt-5.4" } }),
    });
    expect(draft.status).toBe(400);
    expect(await draft.json()).toEqual({ error: "llm_completion_required" });
    expect(llm.calls).toBe(0);
  });

  it("returns 502 llm_failed when the completion is not valid JSON", async () => {
    const { app, llm } = createTestApp();
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
      body: JSON.stringify({ notes: enoughNotes(), completion: draftCompletion("not json") }),
    });
    expect(draft.status).toBe(502);
    expect(await draft.json()).toEqual({ error: "llm_failed" });
    expect(llm.calls).toBe(0);
  });

  it("stores a typed title and company instead of parsing them from notes", async () => {
    const { app } = createTestApp();
    const { headers } = await signIn(app);
    const created = await app.request("/v1/roles", {
      method: "POST",
      headers,
      body: JSON.stringify({ title: "Placeholder", company: "" }),
    });
    const role = await created.json();
    const notes = `About the job
PCT partners with venture-backed technology companies looking for Staff Software Engineers who can bridge the gap. ${enoughNotes()}`;

    const draft = await app.request(`/v1/roles/${role.id}/rubric-drafts`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        notes,
        title: "Forward Deployed Engineer",
        company: "AIM",
        completion: draftCompletion(),
      }),
    });
    expect(draft.status).toBe(201);

    const listed = await app.request("/v1/roles", { headers });
    expect(await listed.json()).toMatchObject({
      roles: [
        {
          id: role.id,
          title: "Forward Deployed Engineer",
          company: "AIM",
        },
      ],
    });
  });

  it("rejects a short job description before calling the model", async () => {
    const { app, llm } = createTestApp();
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
      body: JSON.stringify({ notes: "Need Go." }),
    });
    expect(draft.status).toBe(422);
    expect(await draft.json()).toEqual({ error: "insufficient_notes" });
    expect(llm.calls).toBe(0);
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
      usesRemaining: null,
      replayed: false,
      jev: { model: "jev-1.13.0", cost: { outputUsd: 0 } },
    });
    expect(body.answers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          criterionId: "go",
          excerpt: null,
          llmResult: null,
          llmExcerpt: null,
        }),
      ]),
    );
    expect(body.comparison).toMatchObject({
      instructions: expect.stringContaining("Return only JSON"),
      input: expect.stringContaining(APPROVED_TEXT),
    });
    expect(jev.calls).toBe(1);
    expect(llm.calls).toBe(0);
    expect(db.select().from(evaluations).get()?.approvedText).toBe(APPROVED_TEXT);
  });

  it("does not attach a comparison prompt when comparisonEnabled is omitted", async () => {
    const { jev, llm } = contactProviders();
    const { app } = createTestApp({ jev, llm });
    const { headers } = await signIn(app);
    const { role, rubric } = await approveRubric(app, headers);
    const evaluated = await app.request("/v1/evaluations", {
      method: "POST",
      headers: { ...headers, "Idempotency-Key": "12121212-1212-4121-8121-121212121212" },
      body: JSON.stringify({
        roleId: role.id,
        rubricVersionId: rubric.id,
        approvedText: APPROVED_TEXT,
        keepExtracts: true,
      }),
    });
    expect(evaluated.status).toBe(200);
    const body = await evaluated.json();
    expect(body.comparison).toBeUndefined();
  });

  it("stores a client comparison, grounds excerpts, and leaves LLM dollars null", async () => {
    const { jev, llm } = contactProviders();
    const { app } = createTestApp({ jev, llm });
    const { headers } = await signIn(app);
    const { role, rubric } = await approveRubric(app, headers);
    const evaluated = await app.request("/v1/evaluations", {
      method: "POST",
      headers: { ...headers, "Idempotency-Key": "11111111-1111-4111-8111-111111111111" },
      body: JSON.stringify(evaluateBody(role.id, rubric.id)),
    });
    const created = await evaluated.json();
    const compared = await app.request(`/v1/evaluations/${created.id}/comparison`, {
      method: "POST",
      headers,
      body: JSON.stringify(compareCompletion()),
    });
    expect(compared.status).toBe(200);
    const body = await compared.json();
    expect(body.answers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          criterionId: "go",
          llmResult: "match",
          llmConfidence: 0.91,
          llmExcerpt: "Led the payments API in Go for four years.",
        }),
        expect.objectContaining({
          criterionId: "distributed",
          llmResult: "no_evidence",
          llmConfidence: 0.8,
          llmExcerpt: null,
        }),
      ]),
    );
    expect(body.llm).toMatchObject({
      model: "gpt-5.4",
      usage: { inputTokens: 412, outputTokens: 88 },
      cost: { inputUsd: null, outputUsd: null, totalUsd: 0 },
    });
    expect(llm.calls).toBe(0);
  });

  it("rejects a jev-latest payload as invalid_jev without calling compare", async () => {
    const payload = { ...contactJevPayload, model: "jev-latest" };
    const jev = new FakeJev(() => ({ ok: true, model: "jev-latest", payload }));
    const llm = new FakeLlm({
      compare() {
        return {
          model: "fake-llm",
          answers: [{ criterionId: "go", result: "match", confidence: 0.9, excerpt: "Led the payments API in Go for four years." }],
          usage: { inputTokens: 1, outputTokens: 1 },
        };
      },
    });
    const { app } = createTestApp({ jev, llm });
    const { headers } = await signIn(app);
    const { role, rubric } = await approveRubric(app, headers);
    const res = await app.request("/v1/evaluations", {
      method: "POST",
      headers: { ...headers, "Idempotency-Key": "aaaa1111-1111-4111-8111-111111111111" },
      body: JSON.stringify(evaluateBody(role.id, rubric.id)),
    });
    expect(res.status).toBe(502);
    expect(await res.json()).toMatchObject({
      error: "jev_failed",
      reason: "invalid_jev",
      usesRemaining: null,
    });
    expect(llm.calls).toBe(0);
  });

  it("grounds an excerpt that is not in the approved text to null and still counts the use", async () => {
    const jev = new FakeJev(() => ({ ok: true, model: "jev-1.13.0", payload: contactJevPayload }));
    const { app } = createTestApp({ jev });
    const { headers } = await signIn(app);
    const { role, rubric } = await approveRubric(app, headers);
    const res = await app.request("/v1/evaluations", {
      method: "POST",
      headers: { ...headers, "Idempotency-Key": "bbbb2222-2222-4222-8222-222222222222" },
      body: JSON.stringify(evaluateBody(role.id, rubric.id)),
    });
    expect(res.status).toBe(200);
    const created = await res.json();
    expect(created).toMatchObject({
      countsAsUse: true,
      usesRemaining: null,
    });
    const compared = await app.request(`/v1/evaluations/${created.id}/comparison`, {
      method: "POST",
      headers,
      body: JSON.stringify(
        compareCompletion(
          JSON.stringify({
            answers: ["go", "distributed", "no-ownership", "seniority"].map((criterionId) => ({
              criterionId,
              result: criterionId === "seniority" ? "aligned" : "match",
              confidence: 0.9,
              excerpt: "Python for ten years",
            })),
          }),
        ),
      ),
    });
    const body = await compared.json();
    expect(body.answers).toEqual(
      expect.arrayContaining(
        ["go", "distributed", "no-ownership", "seniority"].map((criterionId) =>
          expect.objectContaining({ criterionId, llmExcerpt: null }),
        ),
      ),
    );
    expect(body.answers).toHaveLength(4);
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
      usesRemaining: null,
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
    expect(getEvaluation(db, body.id)?.approvedText).toBe(APPROVED_TEXT);
    const compared = await app.request(`/v1/evaluations/${body.id}/comparison`, {
      method: "POST",
      headers,
      body: JSON.stringify(compareCompletion()),
    });
    expect(compared.status).toBe(200);
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
    await first.app.request(`/v1/evaluations/${created.id}/comparison`, {
      method: "POST",
      headers,
      body: JSON.stringify(compareCompletion()),
    });

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
        model: "gpt-5.4",
        price: { inputUsdPerMillion: null, outputUsdPerMillion: null },
        cost: { inputUsd: null, outputUsd: null, totalUsd: 0 },
      },
    });
  });

  it("rejects blank approved text before calling Jev", async () => {
    const { jev, llm } = contactProviders();
    const { app } = createTestApp({ jev, llm });
    const { headers } = await signIn(app);
    const { role, rubric } = await approveRubric(app, headers);
    const res = await app.request("/v1/evaluations", {
      method: "POST",
      headers: { ...headers, "Idempotency-Key": "99999999-9999-4999-8999-999999999999" },
      body: JSON.stringify(evaluateBody(role.id, rubric.id, { approvedText: "   " })),
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "invalid_body" });
    expect(jev.calls).toBe(0);
  });

  it("retries a Jev timeout on the same key and then spends one use", async () => {
    let attempts = 0;
    const jev = new FakeJev(() => {
      attempts += 1;
      if (attempts === 1) return { ok: false, reason: "timeout" };
      return { ok: true, model: "jev-1.13.0", payload: contactJevPayload };
    });
    const { llm } = contactProviders();
    const { app, db } = createTestApp({ jev, llm });
    const { headers } = await signIn(app);
    const { role, rubric } = await approveRubric(app, headers);
    const key = "66666666-6666-4666-8666-666666666666";
    const payload = evaluateBody(role.id, rubric.id);

    const failed = await app.request("/v1/evaluations", {
      method: "POST",
      headers: { ...headers, "Idempotency-Key": key },
      body: JSON.stringify(payload),
    });
    expect(failed.status).toBe(502);
    const failure = await failed.json();
    expect(failure).toMatchObject({ error: "jev_failed", reason: "timeout", usesRemaining: null });
    expect(failure.id).toEqual(expect.any(String));
    const failedRow = getEvaluation(db, failure.id);
    expect(failedRow).toMatchObject({ status: "jev_failed", countsAsUse: 0 });
    expect(llm.calls).toBe(0);

    const retried = await app.request("/v1/evaluations", {
      method: "POST",
      headers: { ...headers, "Idempotency-Key": key },
      body: JSON.stringify(payload),
    });
    expect(retried.status).toBe(200);
    expect(await retried.json()).toMatchObject({ id: failure.id, usesRemaining: null, status: "success" });
    expect(db.select().from(evaluations).all()).toHaveLength(1);
    expect(jev.calls).toBe(2);
  });

  it("returns 503 and writes nothing when evaluations are disabled", async () => {
    const { jev, llm } = contactProviders();
    const { app, db } = createTestApp({ jev, llm, env: { evaluationsEnabled: false } });
    const { headers } = await signIn(app);
    const { role, rubric } = await approveRubric(app, headers);
    const res = await app.request("/v1/evaluations", {
      method: "POST",
      headers: { ...headers, "Idempotency-Key": "77777777-7777-4777-8777-777777777777" },
      body: JSON.stringify(evaluateBody(role.id, rubric.id)),
    });
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: "evaluations_disabled" });
    expect(jev.calls).toBe(0);
    expect(db.select().from(evaluations).all()).toEqual([]);
  });

  it("keeps evaluate open after three successes", async () => {
    const { jev, llm } = contactProviders();
    const { app } = createTestApp({ jev, llm });
    const { headers } = await signIn(app);
    const { role, rubric } = await approveRubric(app, headers);
    const keys = [
      "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
      "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
    ];
    for (const key of keys) {
      const res = await app.request("/v1/evaluations", {
        method: "POST",
        headers: { ...headers, "Idempotency-Key": key },
        body: JSON.stringify(evaluateBody(role.id, rubric.id)),
      });
      expect(res.status).toBe(200);
      expect(await res.json()).toMatchObject({ usesRemaining: null });
    }
    expect(jev.calls).toBe(4);
    const me = await app.request("/v1/me", { headers });
    expect(await me.json()).toMatchObject({
      successCount: 4,
      usesRemaining: null,
      cap: null,
      rolesRemaining: 3,
      roleCap: 3,
    });
  });

  it("lets a user with a stored cap of 100 evaluate after three successes", async () => {
    const { jev, llm } = contactProviders();
    const { app, db } = createTestApp({ jev, llm });
    const { headers } = await signIn(app);
    const user = db.select().from(users).where(eq(users.email, "recruiter@example.com")).get();
    expect(user).toBeTruthy();
    db.update(users).set({ trialSuccessCap: 100 }).where(eq(users.id, user!.id)).run();
    for (let index = 0; index < 3; index += 1) {
      db.insert(trialUses)
        .values({ id: `use-${index}`, userId: user!.id, evaluationId: `eval-${index}`, createdAt: index })
        .run();
    }
    const { role, rubric } = await approveRubric(app, headers);
    const evaluated = await app.request("/v1/evaluations", {
      method: "POST",
      headers: { ...headers, "Idempotency-Key": "17171717-1717-4171-8171-171717171717" },
      body: JSON.stringify(evaluateBody(role.id, rubric.id)),
    });
    expect(evaluated.status).toBe(200);

    const me = await app.request("/v1/me", { headers });
    expect(await me.json()).toMatchObject({
      successCount: 4,
      usesRemaining: null,
      cap: null,
      rolesRemaining: 100,
      roleCap: 100,
    });
  });

  it("keeps evaluate open after three successes when the trial cap is unlimited", async () => {
    const { jev, llm } = contactProviders();
    const { app } = createTestApp({ jev, llm, env: { trialSuccessCap: null } });
    const { headers } = await signIn(app);
    const { role, rubric } = await approveRubric(app, headers);
    for (const key of [
      "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
      "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
    ]) {
      const res = await app.request("/v1/evaluations", {
        method: "POST",
        headers: { ...headers, "Idempotency-Key": key },
        body: JSON.stringify(evaluateBody(role.id, rubric.id)),
      });
      expect(res.status).toBe(200);
    }
    expect(jev.calls).toBe(4);
    const me = await app.request("/v1/me", { headers });
    expect(await me.json()).toMatchObject({
      successCount: 4,
      usesRemaining: null,
      cap: null,
      rolesRemaining: null,
      roleCap: null,
    });
  });

  it("records a correction, notes, history totals, and a single-row delete", async () => {
    const { jev, llm } = contactProviders();
    const { app, db } = createTestApp({ jev, llm });
    const { headers } = await signIn(app);
    const { role, rubric } = await approveRubric(app, headers);
    const evaluated = await app.request("/v1/evaluations", {
      method: "POST",
      headers: { ...headers, "Idempotency-Key": "88888888-8888-4888-8888-888888888888" },
      body: JSON.stringify(evaluateBody(role.id, rubric.id)),
    });
    const created = await evaluated.json();

    const corrected = await app.request(`/v1/evaluations/${created.id}/corrections`, {
      method: "POST",
      headers,
      body: JSON.stringify({ action: "skip" }),
    });
    expect(corrected.status).toBe(201);
    expect(await corrected.json()).toEqual({ action: "skip" });

    const noted = await app.request(`/v1/evaluations/${created.id}`, {
      method: "PATCH",
      headers,
      body: JSON.stringify({ notes: "Maya asked about the payments API." }),
    });
    expect(noted.status).toBe(200);
    expect(await noted.json()).toEqual({ notes: "Maya asked about the payments API." });

    const history = await app.request("/v1/evaluations", { headers });
    expect(history.status).toBe(200);
    expect(await history.json()).toEqual({
      evaluations: [
        {
          id: created.id,
          status: "success",
          action: "contact",
          roleId: role.id,
          roleTitle: "Senior backend engineer",
          candidateName: "",
          jevTotalUsd: 0.00009156,
          llmTotalUsd: 0,
          comparisonEnabled: true,
        },
      ],
      totals: { jevUsd: 0.00009156, llmUsd: 0 },
    });

    const removed = await app.request(`/v1/evaluations/${created.id}`, { method: "DELETE", headers });
    expect(removed.status).toBe(204);
    expect(getEvaluation(db, created.id)).toBeUndefined();
    const me = await app.request("/v1/me", { headers });
    expect(await me.json()).toMatchObject({
      successCount: 1,
      usesRemaining: null,
      cap: null,
      rolesRemaining: 3,
      roleCap: 3,
    });
  });
});

describe("GET /v1/evaluations/:id", () => {
  it("includes the role title and criterion labels from that run", async () => {
    const { jev, llm } = contactProviders();
    const { app } = createTestApp({ jev, llm });
    const { headers } = await signIn(app);
    const { role, rubric } = await approveRubric(app, headers);
    const evaluated = await app.request("/v1/evaluations", {
      method: "POST",
      headers: { ...headers, "Idempotency-Key": "11111111-1111-4111-8111-111111111111" },
      body: JSON.stringify(
        evaluateBody(role.id, rubric.id, {
          approvedText: "Headline\nTim Glaser — CEO at TypeSafe\n\nAbout\nLed the payments API in Go for four years.",
        }),
      ),
    });
    const created = await evaluated.json();

    const got = await app.request(`/v1/evaluations/${created.id}`, { headers });
    expect(got.status).toBe(200);
    const body = await got.json();
    expect(body.roleTitle).toBe("Senior backend engineer");
    expect(body.candidateName).toBe("Tim Glaser");
    expect(body.answers.find((answer: { criterionId: string }) => answer.criterionId === "go")?.label).toBe(
      "Go, five or more years",
    );
    const go = body.answers.find((answer: { criterionId: string }) => answer.criterionId === "go");
    expect(go?.prompt).toBe("Is there evidence of at least five years of Go?");
    expect(go?.kind).toBe("requirement");
    expect(go?.result).toBeDefined();
  });
});

describe("GET /v1/evaluations", () => {
  it("includes the LinkedIn name from the Headline section", async () => {
    const { jev, llm } = contactProviders();
    const { app } = createTestApp({ jev, llm });
    const { headers } = await signIn(app);
    const { role, rubric } = await approveRubric(app, headers);
    const evaluated = await app.request("/v1/evaluations", {
      method: "POST",
      headers: { ...headers, "Idempotency-Key": "15151515-1515-4151-8151-151515151515" },
      body: JSON.stringify(
        evaluateBody(role.id, rubric.id, {
          approvedText: "Headline\nTim Glaser — CEO at TypeSafe\n\nAbout\nLed the payments API in Go for four years.",
          keepExtracts: false,
        }),
      ),
    });
    expect(evaluated.status).toBe(200);

    const history = await app.request("/v1/evaluations", { headers });
    expect(history.status).toBe(200);
    expect(await history.json()).toMatchObject({
      evaluations: [{ candidateName: "Tim Glaser", roleTitle: "Senior backend engineer" }],
    });
  });

  it("includes status on each item and returns newest first", async () => {
    const { jev, llm } = contactProviders();
    const { app, db } = createTestApp({ jev, llm });
    const { headers } = await signIn(app);
    const { role, rubric } = await approveRubric(app, headers);
    const older = await app.request("/v1/evaluations", {
      method: "POST",
      headers: { ...headers, "Idempotency-Key": "12121212-1212-4121-8121-121212121212" },
      body: JSON.stringify(evaluateBody(role.id, rubric.id)),
    });
    const newer = await app.request("/v1/evaluations", {
      method: "POST",
      headers: { ...headers, "Idempotency-Key": "13131313-1313-4131-8131-131313131313" },
      body: JSON.stringify(evaluateBody(role.id, rubric.id)),
    });
    const first = await older.json();
    const second = await newer.json();
    const firstRow = getEvaluation(db, first.id);
    db.update(evaluations)
      .set({ createdAt: (firstRow?.createdAt ?? 0) - 1000 })
      .where(eq(evaluations.id, first.id))
      .run();

    const history = await app.request("/v1/evaluations", { headers });
    expect(history.status).toBe(200);
    const body = await history.json();
    expect(body.evaluations.map((item: { id: string; status: string }) => ({ id: item.id, status: item.status }))).toEqual([
      { id: second.id, status: "success" },
      { id: first.id, status: "success" },
    ]);
  });

  it("lists a jev_failed row with a status that is not success", async () => {
    const jev = new FakeJev(() => ({ ok: false, reason: "timeout" }));
    const { llm } = contactProviders();
    const { app } = createTestApp({ jev, llm });
    const { headers } = await signIn(app);
    const { role, rubric } = await approveRubric(app, headers);
    const failed = await app.request("/v1/evaluations", {
      method: "POST",
      headers: { ...headers, "Idempotency-Key": "14141414-1414-4141-8141-141414141414" },
      body: JSON.stringify(evaluateBody(role.id, rubric.id)),
    });
    const failure = await failed.json();

    const history = await app.request("/v1/evaluations", { headers });
    expect(history.status).toBe(200);
    const body = await history.json();
    expect(body.evaluations).toEqual([
      expect.objectContaining({ id: failure.id, status: "jev_failed" }),
    ]);
    expect(body.evaluations[0].status).not.toBe("success");
  });
});

describe("DELETE /v1/evaluations?roleId", () => {
  it("deletes only that role's evaluations and leaves the other role's history", async () => {
    const { jev, llm } = contactProviders();
    const { app, db } = createTestApp({ jev, llm });
    const { headers } = await signIn(app);
    const first = await approveRubric(app, headers);
    const second = await approveRubric(app, headers);
    const kept = await app.request("/v1/evaluations", {
      method: "POST",
      headers: { ...headers, "Idempotency-Key": "16161616-1616-4161-8161-161616161616" },
      body: JSON.stringify(evaluateBody(first.role.id, first.rubric.id)),
    });
    const wiped = await app.request("/v1/evaluations", {
      method: "POST",
      headers: { ...headers, "Idempotency-Key": "17171717-1717-4171-8171-171717171717" },
      body: JSON.stringify(evaluateBody(second.role.id, second.rubric.id)),
    });
    const keptRow = await kept.json();
    const wipedRow = await wiped.json();

    const removed = await app.request(`/v1/evaluations?roleId=${second.role.id}`, { method: "DELETE", headers });
    expect(removed.status).toBe(204);
    expect(getEvaluation(db, wipedRow.id)).toBeUndefined();
    expect(getEvaluation(db, keptRow.id)?.id).toBe(keptRow.id);

    const history = await app.request("/v1/evaluations", { headers });
    expect(await history.json()).toMatchObject({
      evaluations: [{ id: keptRow.id, roleId: first.role.id }],
    });
  });
});

function utcMidnight(daysAgo = 0) {
  const now = new Date();
  return Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - daysAgo);
}

function insertSpendRow(
  db: ReturnType<typeof createTestApp>["db"],
  userId: string,
  roleId: string,
  rubricVersionId: string,
  createdAt: number,
  jevTotal: number,
  llmTotal: number,
) {
  db.insert(evaluations)
    .values({
      id: crypto.randomUUID(),
      userId,
      roleId,
      rubricVersionId,
      idempotencyKey: crypto.randomUUID(),
      bodyHash: `spend-${createdAt}`,
      status: "success",
      countsAsUse: 0,
      jevInputUsd: jevTotal,
      jevOutputUsd: 0,
      llmInputUsd: llmTotal,
      llmOutputUsd: 0,
      keepExtracts: 0,
      comparisonEnabled: 1,
      createdAt,
      updatedAt: createdAt,
    })
    .run();
}

describe("daily spend cap", () => {
  it("returns 503 and calls nothing when today's stored spend is already at the cap", async () => {
    const { jev, llm } = contactProviders();
    const { app, db } = createTestApp({ jev, llm, env: { dailySpendCapUsd: 5 } });
    const { headers } = await signIn(app);
    const { role, rubric } = await approveRubric(app, headers);
    const user = db.select().from(users).get();
    insertSpendRow(db, user!.id, role.id, rubric.id, Date.now(), 4, 1);

    const res = await app.request("/v1/evaluations", {
      method: "POST",
      headers: { ...headers, "Idempotency-Key": "f1f1f1f1-f1f1-41f1-81f1-f1f1f1f1f1f1" },
      body: JSON.stringify(evaluateBody(role.id, rubric.id)),
    });
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: "daily_spend_cap" });
    expect(jev.calls).toBe(0);
  });

  it("does not count yesterday's spend against today's cap", async () => {
    const { jev, llm } = contactProviders();
    const { app, db } = createTestApp({ jev, llm, env: { dailySpendCapUsd: 5 } });
    const { headers } = await signIn(app);
    const { role, rubric } = await approveRubric(app, headers);
    const user = db.select().from(users).get();
    insertSpendRow(db, user!.id, role.id, rubric.id, utcMidnight(1) - 1, 9, 0);

    const res = await app.request("/v1/evaluations", {
      method: "POST",
      headers: { ...headers, "Idempotency-Key": "f2f2f2f2-f2f2-42f2-82f2-f2f2f2f2f2f2" },
      body: JSON.stringify(evaluateBody(role.id, rubric.id)),
    });
    expect(res.status).toBe(200);
    expect(jev.calls).toBe(1);
  });

  it("still returns 503 after history is cleared when today's spend was already at the cap", async () => {
    const { jev, llm } = contactProviders();
    const { app, db } = createTestApp({ jev, llm, env: { dailySpendCapUsd: 5 } });
    const { headers } = await signIn(app);
    const { role, rubric } = await approveRubric(app, headers);
    const user = db.select().from(users).get();
    insertSpendRow(db, user!.id, role.id, rubric.id, Date.now(), 4, 1);

    const wiped = await app.request("/v1/evaluations", { method: "DELETE", headers });
    expect(wiped.status).toBe(204);

    const res = await app.request("/v1/evaluations", {
      method: "POST",
      headers: { ...headers, "Idempotency-Key": "f3f3f3f3-f3f3-43f3-83f3-f3f3f3f3f3f3" },
      body: JSON.stringify(evaluateBody(role.id, rubric.id)),
    });
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: "daily_spend_cap" });
    expect(jev.calls).toBe(0);
  });
});



